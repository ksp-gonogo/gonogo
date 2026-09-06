import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { promisify } from "node:util";
import type { Browser, BrowserContext, Page, TestInfo } from "@playwright/test";
import { expect } from "@playwright/test";
import { seedContext } from "./helpers";

/**
 * The machinery two radio scenes share: three real screens on the real mesh,
 * a recorded clip standing in for each microphone, a tape on each screen's own
 * speakers, and one stacked mp4 at the end with each pane carrying the audio
 * that pane's decoder actually produced.
 *
 * Extracted from `commcast-radio.spec.ts` when the station scene needed the
 * same rig from a different mount. Nothing here decides what a scene DOES: the
 * vantages, the beats and the assertions belong to the spec, and this owns only
 * the parts that would otherwise be copied.
 *
 * What is real: the widget, the composer, the key, the transmitter,
 * `CommcastMesh` over PeerJS, `CommcastLog`, `RadioSession`, the delayed playout
 * buffer, the pacer, and each screen's own view clock. What is substituted is
 * the microphone and the codec, through the seam `backend.ts` offers and
 * `InjectedRadioBackend` provides.
 */

const execFileAsync = promisify(execFile);

/** Vantage ids, matching the three servers `playwright.config.ts` launches. */
export const KSC = "ksc";
export const NEAR = "vessel:near";
export const FAR = "vessel:far";

/** One-way seconds between mission control and each craft. */
export const NEAR_SECONDS = 3;
export const FAR_SECONDS = 9;
/** Craft to craft, so the matrix is complete rather than only useful. */
export const NEAR_FAR_SECONDS = 7;

export const NAMES: Record<string, string> = {
  [KSC]: "Mission Control",
  [NEAR]: "Near Craft",
  [FAR]: "Far Craft",
};

/**
 * Each screen renders at this size, so the stacked film tiles evenly.
 *
 * Large enough that the widget is READABLE at a normal playback size once three
 * of them are side by side, and no larger. The screencast is the constraint,
 * not the disk: three contexts recording at 900x620 could not keep up with the
 * wall, and a pane whose recording runs slow cannot be aligned by trimming,
 * because trimming assumes a second of video is a second of wall. Measured, the
 * station's pane came out THIRTY-THREE SECONDS behind the other two, which the
 * stopwatch drawn on each pane is what caught.
 *
 * The width also decides the grid: 800 leaves a container comfortably inside
 * the `xs` band rather than on the 768 px boundary between two column counts.
 */
export const SCREEN_SIZE = { width: 800, height: 520 } as const;

/**
 * The grid's real column counts, from
 * `packages/app/src/components/Dashboard/layoutNormalization.ts`.
 *
 * Repeated here rather than guessed, which is the whole reason this exists.
 * `dashboardWithWidget` in `helpers.ts` carries its own 12/10/8/6/4, which
 * matches nothing the app uses: at a 900 px viewport the grid picks `sm` and
 * gives out EIGHTEEN columns, so a layout asking for eight got less than half
 * the pane and the widget was photographed in a corner of its own screen.
 * Every entry here is the full width of its breakpoint, so whichever one the
 * container lands on, the widget fills the pane.
 */
const GRID_COLS = { lg: 36, md: 30, sm: 18, xs: 12, xxs: 6 } as const;

/**
 * Rows tall enough to fill the pane under the caption strip, at the grid's own
 * 25 px row and 10 px margin.
 */
const GRID_ROWS = 12;

/** The commcast widget, filling whatever breakpoint the pane lands on. */
function commcastDashboard() {
  const i = "widget-commcast";
  const at = (w: number) => [
    { i, x: 0, y: 0, w, h: GRID_ROWS, moved: false, static: false },
  ];
  return {
    items: [{ i, componentId: "commcast" }],
    layouts: Object.fromEntries(
      Object.entries(GRID_COLS).map(([bp, cols]) => [bp, at(cols)]),
    ),
  };
}

/**
 * Wall ms the film holds still, before the key and after the last word.
 *
 * A picture of an instrument needs a before and an after or there is nothing to
 * read the change against, and the recording used to open on a page mid-boot
 * and cut the instant the assertions were satisfied.
 */
export const HOLD_MS = 3_500;

export interface ReceptionWatch {
  /** Wall ms at the first chunk this screen actually decoded, or null. */
  firstDecodeAt: number | null;
  /** Wall ms the transmission lamp first lit, or null. */
  litAt: number | null;
  /** Wall ms the lamp went dark again after lighting, or null. */
  darkAt: number | null;
  /** Wall ms of the most recent decode, so a playout's span can be measured. */
  lastDecodeAt: number | null;
  /** Every chunk index decoded, in the order they reached the speakers. */
  decoded: number[];
  /** Chunks each listening chain took, newest chain last. */
  decoderLengths: number[];
  /**
   * Streams started on each listening chain, newest chain last.
   *
   * The reading a mute leaves behind. A muted chunk ends the stream without
   * decoding it, so the next audible one starts a fresh stream on the SAME
   * lane: the lane count is unchanged and this is the only place the gap shows
   * up as a positive fact rather than as an absence.
   */
  decoderResets: number[];
  /** Chunks this screen's own microphone has put on the wire. */
  spoken: number;
}

/** One block of decoded audio, with the wall instant it reached the speakers. */
export interface TapedBlock {
  /** `Date.now()` at the `play` call, the same clock the video is aligned on. */
  at: number;
  sampleRate: number;
  /** Signed 16-bit mono PCM, base64. */
  pcm: string;
}

export interface Screen {
  name: string;
  context: BrowserContext;
  page: Page;
  /** Wall ms the recording started, so the stacked film can be aligned. */
  recordingFrom: number;
  /** What this screen's speakers were handed, read off before the page closes. */
  audio: TapedBlock[];
}

/** One frame the fixture stream is holding for every screen. */
export interface SceneFrame {
  topic: string;
  payload: unknown;
}

/**
 * The scene every screen observes: who exists, and how far apart they are.
 *
 * Published to all three servers rather than baked into them, so the
 * separations a test runs at are values in the test. Every ordered pair is
 * present including the self-zeros, which the contract requires: a reader that
 * finds no entry for a pair reads "unavailable", a different fact from zero.
 */
export function scene(): SceneFrame[] {
  const pair = (from: string, to: string, oneWaySeconds: number) => ({
    from,
    to,
    oneWaySeconds,
  });
  return [
    {
      topic: "commandCentre.roster",
      payload: [
        {
          id: KSC,
          displayName: NAMES[KSC],
          kind: "GroundStation",
          active: true,
          delayQuality: "routed",
        },
        {
          id: NEAR,
          displayName: NAMES[NEAR],
          kind: "CrewedVessel",
          active: true,
          delayQuality: "routed",
        },
        {
          id: FAR,
          displayName: NAMES[FAR],
          kind: "CrewedVessel",
          active: true,
          delayQuality: "routed",
        },
      ],
    },
    {
      topic: "commandCentre.separation",
      payload: {
        pairs: [
          pair(KSC, KSC, 0),
          pair(NEAR, NEAR, 0),
          pair(FAR, FAR, 0),
          pair(KSC, NEAR, NEAR_SECONDS),
          pair(NEAR, KSC, NEAR_SECONDS),
          pair(KSC, FAR, FAR_SECONDS),
          pair(FAR, KSC, FAR_SECONDS),
          pair(NEAR, FAR, NEAR_FAR_SECONDS),
          pair(FAR, NEAR, NEAR_FAR_SECONDS),
        ],
      },
    },
    // Published connected rather than left silent: the widget reads silence as
    // connected anyway, and saying so makes it the recorded state.
    { topic: "comms.link", payload: { connected: true } },
  ];
}

export async function publishScene(ports: readonly number[]): Promise<void> {
  const body = JSON.stringify(scene());
  for (const port of ports) {
    const res = await fetch(`http://localhost:${port}/publish`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
    });
    expect(res.ok, `publish to ${port}`).toBe(true);
  }
}

/** How long a clip of `chunks` chunks lasts, at the 20 ms grid it is cut on. */
export const CHUNK_MS = 20;
export const clipSeconds = (chunks: number) => (chunks * CHUNK_MS) / 1000;

export interface ClipSpec {
  /** What the clip is called; only ever read back off the wire in a failure. */
  name: string;
  chunks: number;
  /**
   * Pitch, so two screens talking at once are two distinguishable voices.
   *
   * Audible rather than decorative: the two-talkers beat is a claim about the
   * mix, and a listener who cannot tell the voices apart cannot check it.
   */
  baseHz?: number;
}

/**
 * Runs this page's radio on a recorded clip, with a tape running on the sink.
 *
 * The clip module is reached through the DEV SERVER's own module URL rather
 * than bundled into the app: the seam takes a backend the page hands it, so
 * nothing about a stand-in microphone is in the app's module graph, and what
 * loads here is the same `clips.ts` the jsdom suites use.
 *
 * The tape wraps `createReceiver` -> `openStream` -> `sink.play`, and that
 * chain is the whole shape of `RadioBackend`: `{ startCapture, createReceiver }`
 * and nothing else. An earlier tape wrapped a `createDecoder` that no backend
 * has ever had, so the handle it published failed `isRadioBackend`'s two-member
 * check, the page silently kept the REAL WebAudio backend, and every scene
 * timed out waiting for a receiver that was never going to be built. It wraps
 * rather than replaces because the recording is a property of THIS scene, and
 * what it observes is exactly the samples the shipped session handed the
 * speakers, at the instant it handed them over. Converted to int16 on the spot
 * and left as binary until the dump, because this runs on the 20 ms playout
 * tick that the whole timing measurement is made of, and base64 on that path
 * would be the instrument disturbing its own subject.
 */
export async function installClipRadio(
  page: Page,
  clip: ClipSpec,
): Promise<void> {
  await page.evaluate(
    async ({
      name,
      chunks,
      baseHz,
    }: {
      name: string;
      chunks: number;
      baseHz?: number;
    }) => {
      const clips = (await import(
        /* @vite-ignore */ "/src/commcast/radio/clips.ts"
      )) as {
        makeClip: (
          name: string,
          chunkCount: number,
          baseHz?: number,
        ) => unknown;
        clipRadio: (clip: unknown) => {
          backend: {
            startCapture: unknown;
            createReceiver: () => {
              openStream: () => { sink: { play: unknown } };
            };
          };
        };
      };
      const radio = clips.clipRadio(clips.makeClip(name, chunks, baseHz));
      const holder = window as unknown as Record<string, unknown>;
      const tape: { at: number; sampleRate: number; samples: Int16Array }[] =
        [];
      holder.__gonogoRadioTape = tape;
      const build = radio.backend.createReceiver;
      const backend = {
        startCapture: radio.backend.startCapture,
        createReceiver: () => {
          const receiver = build();
          const open = receiver.openStream.bind(receiver);
          receiver.openStream = () => {
            const decoder = open();
            const sink = decoder.sink;
            const play = (
              sink.play as (s: Float32Array, r: number) => void
            ).bind(sink);
            sink.play = (samples: Float32Array, sampleRate: number) => {
              const pcm = new Int16Array(samples.length);
              for (let i = 0; i < samples.length; i++) {
                const s = Math.max(-1, Math.min(1, samples[i]));
                pcm[i] = Math.round(s * 32767);
              }
              tape.push({ at: Date.now(), sampleRate, samples: pcm });
              play(samples, sampleRate);
            };
            return decoder;
          };
          return receiver;
        },
      };
      holder.__gonogoClipRadio = radio;
      holder.__gonogoRadioBackend = backend;
      window.dispatchEvent(new Event("gonogo:radio-backend"));
    },
    { name: clip.name, chunks: clip.chunks, baseHz: clip.baseHz },
  );
  /*
   * The swap tears down the real session and stands a fresh one up, and the
   * listening OUTPUT is what says it landed: `useRadio` builds exactly one
   * receiver per session, off the backend it was handed, so a receiver existing
   * here means this screen is hearing through the clip rather than through
   * WebCodecs. Waiting on the KEY instead would not do: the key lives in the
   * composer, which only exists inside a conversation, and a receiving screen
   * never opens one.
   *
   * The receiver rather than a decoder, because a decode STREAM is opened per
   * transmission and this screen has not heard one yet: waiting on `decoders`
   * would wait for somebody to talk, which is the thing the test goes on to do.
   */
  await page.waitForFunction(
    () =>
      (
        (window as unknown as Record<string, unknown>).__gonogoClipRadio as
          | { receivers: unknown[] }
          | undefined
      )?.receivers.length !== 0,
    undefined,
    { timeout: 20_000, polling: 50 },
  );
}

/**
 * Starts watching what this screen HEARS, on a 10 ms poll.
 *
 * Two independent instruments, deliberately. The decoder says when audio
 * actually reached the speakers, to the poll's resolution; the lamp says what
 * the operator was told. A test that read only the first could pass with the
 * widget drawing nothing, and one that read only the second could pass on a
 * lamp lit by the envelope.
 *
 * `Date.now()` rather than `performance.now()` because the instants are
 * compared ACROSS pages: three time origins are three different zeroes, and
 * the whole measurement is a difference between screens.
 */
export async function watchReception(page: Page): Promise<void> {
  await page.evaluate(() => {
    const holder = window as unknown as Record<string, unknown>;
    const watch = {
      firstDecodeAt: null as number | null,
      litAt: null as number | null,
      darkAt: null as number | null,
      lastDecodeAt: null as number | null,
      seen: 0,
    };
    holder.__radioWatch = watch;
    /*
     * The RECEIVER's lamp specifically. `RadioIndicator` puts a lowercase
     * " transmitting" inside its own polite status region for exactly the
     * reader a pulsing dot does not serve; the composer's own key announces
     * "Transmitting" capitalised, on the sending screen, and must not be
     * mistaken for hearing somebody.
     */
    const lit = () =>
      [
        ...document.querySelectorAll('[role="status"][aria-live="polite"]'),
      ].some((el) => (el.textContent ?? "").includes(" transmitting"));
    const timer = setInterval(() => {
      const radio = holder.__gonogoClipRadio as
        | { decoders: { decoded: unknown[] }[] }
        | undefined;
      const decoded = (radio?.decoders ?? []).reduce(
        (n, d) => n + d.decoded.length,
        0,
      );
      if (decoded > watch.seen) {
        watch.seen = decoded;
        watch.lastDecodeAt = Date.now();
        watch.firstDecodeAt ??= watch.lastDecodeAt;
      }
      const on = lit();
      if (on) watch.litAt ??= Date.now();
      else if (watch.litAt !== null) watch.darkAt ??= Date.now();
    }, 10);
    holder.__radioWatchStop = () => clearInterval(timer);
  });
}

export async function reception(page: Page): Promise<ReceptionWatch> {
  return (await page.evaluate(() => {
    const holder = window as unknown as Record<string, unknown>;
    const watch = holder.__radioWatch as Omit<
      ReceptionWatch,
      "decoded" | "spoken"
    >;
    const radio = holder.__gonogoClipRadio as
      | {
          decoders: { decoded: { index: number }[]; resets: number }[];
          mic: { spoken: number };
        }
      | undefined;
    return {
      ...watch,
      decoded: (radio?.decoders ?? []).flatMap((d) =>
        d.decoded.map((c) => c.index),
      ),
      decoderLengths: (radio?.decoders ?? []).map((d) => d.decoded.length),
      decoderResets: (radio?.decoders ?? []).map((d) => d.resets),
      spoken: radio?.mic.spoken ?? 0,
    };
  })) as Promise<ReceptionWatch>;
}

/**
 * Waits, from the TEST rather than from the page, for `until` to hold.
 *
 * `page.waitForFunction` is the obvious tool and it does not work here.
 * Measured on firefox: three contexts are open and at most one page is
 * foreground, and a poller injected into a backgrounded page is starved badly
 * enough that a condition true within four seconds went unseen for thirty. The
 * same run, waiting a fixed interval on the host and then reading the SAME
 * value, saw it set. So the predicate is evaluated by a host-driven
 * `page.evaluate` on a host-driven interval, and nothing about the wait depends
 * on which of the three screens the engine decided to favour.
 */
export async function waitForReception(
  page: Page,
  until: (heard: ReceptionWatch) => boolean,
  opts: { timeout: number; message: string },
): Promise<void> {
  await expect
    .poll(async () => until(await reception(page)), {
      timeout: opts.timeout,
      intervals: [100],
      message: opts.message,
    })
    .toBe(true);
}

/** Open the conversation with `name`, the way an operator reaches one. */
export async function openConversation(
  page: Page,
  name: string,
): Promise<void> {
  await page.getByRole("button", { name: "New message" }).click();
  /*
   * A list ROW, never a control that happens to carry the same words: every
   * row is a toggle and so carries `aria-pressed`, which the station-name
   * editor in the panel header does not.
   */
  await page.locator("button[aria-pressed]").filter({ hasText: name }).click();
  await page.getByRole("button", { name: "Open" }).click();
}

/**
 * The key, by the one name it answers to in every state.
 *
 * `Talk` throughout, latched or not: the control's label is fixed and
 * `aria-pressed` carries the state, so a query written against the state it
 * expects would silently match nothing the moment the key was already down.
 */
export const talkKey = (page: Page) =>
  page.getByRole("button", { name: "Talk" });

/** The mute beside it, named for the conversation it tunes out, in both states. */
export const muteKey = (page: Page, threadName: string) =>
  page.getByRole("button", { name: `Mute ${threadName}` });

/** Latch the key and return the wall instant it caught, read on the page. */
export async function keyDown(page: Page): Promise<number> {
  await talkKey(page).click();
  await expect(talkKey(page)).toHaveAttribute("aria-pressed", "true");
  return await page.evaluate(() => Date.now());
}

export async function keyUp(page: Page): Promise<void> {
  await talkKey(page).click();
  await expect(talkKey(page)).toHaveAttribute("aria-pressed", "false");
}

/**
 * The voice ribbon this screen is publishing onto its own panel's delay rail.
 *
 * `role="img"` with the crossing's own accessible name, which is what
 * `RailCrossing` renders and the only thing about the rail that names WHICH
 * crossing is drawn.
 */
export const voiceRibbon = (page: Page) =>
  page.getByRole("img", { name: /transmission crossing to/i });

/**
 * Speak the clip at the grid it was recorded on, and return immediately.
 *
 * At natural rate rather than in one go, because the scene is a measurement of
 * WHEN: a whole clip emitted in one tick would be a single instant on the wire
 * and would tell you nothing about a playout, and on the video it would be a
 * flash rather than somebody talking.
 */
export async function speak(page: Page, chunks?: number): Promise<void> {
  await page.evaluate((limit: number | null) => {
    const radio = (window as unknown as Record<string, unknown>)
      .__gonogoClipRadio as { mic: { speak: () => boolean; spoken: number } };
    /*
     * Paced against the WALL rather than one chunk per tick. Three contexts are
     * open and at most one is foreground, and a backgrounded page's timers are
     * throttled: a tick-counting microphone would then speak in slow motion and
     * the utterance would outlast the measurement it is the subject of. Catching
     * up to the elapsed time keeps the clip on the grid it was recorded at
     * whatever the engine does to the timer.
     */
    const from = Date.now();
    /*
     * Counted from where this microphone has already got to, not from zero. A
     * clip is spoken once and `ClipMic` never rewinds, so a screen that keys a
     * second time carries on through the same clip: the OFFSET is what makes
     * two utterances from one screen possible at all, and a `speak` that
     * assumed an unused microphone would emit nothing the second time and the
     * scene would fail as a delivery failure rather than as an empty one.
     */
    const started = radio.mic.spoken;
    const stopAt = limit === null ? Number.POSITIVE_INFINITY : started + limit;
    const timer = setInterval(() => {
      const due = Math.min(
        stopAt,
        started + Math.floor((Date.now() - from) / 20) + 1,
      );
      while (radio.mic.spoken < due) {
        if (!radio.mic.speak()) {
          clearInterval(timer);
          return;
        }
      }
      if (radio.mic.spoken >= stopAt) clearInterval(timer);
    }, 20);
  }, chunks ?? null);
}

/** Everything this screen's speakers were handed, with its own wall instants. */
export async function takeAudio(page: Page): Promise<TapedBlock[]> {
  return await page.evaluate(() => {
    const tape =
      ((window as unknown as Record<string, unknown>).__gonogoRadioTape as
        | { at: number; sampleRate: number; samples: Int16Array }[]
        | undefined) ?? [];
    return tape.map((block) => {
      const bytes = new Uint8Array(
        block.samples.buffer,
        block.samples.byteOffset,
        block.samples.byteLength,
      );
      /*
       * Chunked: `String.fromCharCode(...bytes)` on a whole utterance blows the
       * argument limit, and the failure is a stack overflow rather than a
       * truncation, so it would take the whole run down at teardown.
       */
      let binary = "";
      const step = 0x8000;
      for (let i = 0; i < bytes.length; i += step) {
        binary += String.fromCharCode(...bytes.subarray(i, i + step));
      }
      return { at: block.at, sampleRate: block.sampleRate, pcm: btoa(binary) };
    });
  });
}

export interface OpenScreenOptions {
  name: string;
  url: string;
  dashboardKey: "gonogo:dashboard:main" | "gonogo:dashboard:station";
  sitrepPort: number;
  videoDir: string;
  clip: ClipSpec;
}

export async function openScreen(
  browser: Browser,
  opts: OpenScreenOptions,
): Promise<Screen> {
  const context = await browser.newContext({
    viewport: { ...SCREEN_SIZE },
    recordVideo: { dir: opts.videoDir, size: { ...SCREEN_SIZE } },
  });
  await seedContext(
    context,
    opts.dashboardKey,
    /*
     * Full width and tall, so the bar carrying the key, the mute and the lamp
     * is on screen without scrolling and the delay rail above the panel's title
     * has room to draw the voice crossing: a control the video cannot see is a
     * control the reviewer cannot check.
     */
    commcastDashboard(),
    opts.sitrepPort,
  );
  const page = await context.newPage();
  /*
   * Recording begins with the page, and each screen opens several seconds
   * after the last: without this the stacked film would show three clips
   * starting at three different wall instants, which is a picture of the
   * harness rather than of the delay.
   */
  const recordingFrom = Date.now();
  page.on("pageerror", (err) =>
    console.error(`[${opts.name}] page error:`, err.message),
  );
  await page.goto(opts.url);
  await expect(page.getByText("Commcast").first()).toBeVisible({
    timeout: 45_000,
  });
  await installClipRadio(page, opts.clip);
  await watchReception(page);
  return { name: opts.name, context, page, recordingFrom, audio: [] };
}

/* ------------------------------------------------------------------------- *
 * Captions: what a reviewer needs on the picture to read it without the spec
 * ------------------------------------------------------------------------- */

export interface CaptionOptions {
  /** What this screen IS, in the largest type on the pane. */
  title: string;
  /** Its route and vantage, under the title. */
  subtitle: string;
  /** Border tint, so a pane stays identifiable when the caption changes. */
  accent: string;
  /**
   * Wall ms the film's clock reads zero at, shared by every pane.
   *
   * The panes are trimmed back to a common start, so one stopwatch drawn from
   * one epoch on three pages of one machine reads the same in all three. That
   * is what lets a reviewer take the light-time off the PICTURE: keyed at
   * T+12.0 on one pane, heard at T+15.0 on another, with no timeline to trust
   * but the one they can see.
   */
  epoch: number;
}

/**
 * Draw the pane's own identity, a shared stopwatch, and a caption strip.
 *
 * Injected by the test rather than built into the app, and inert: the whole
 * overlay is `pointer-events: none`, so nothing here can intercept a click the
 * scene goes on to make. It sits at the very top of the stacking order because
 * the one thing worse than no caption is a caption a modal covers.
 */
export async function installCaption(
  page: Page,
  opts: CaptionOptions,
): Promise<void> {
  await page.evaluate((o: CaptionOptions) => {
    const existing = document.getElementById("__scene-overlay");
    existing?.remove();
    const root = document.createElement("div");
    root.id = "__scene-overlay";
    root.style.cssText = [
      "position:fixed",
      "inset:0",
      "pointer-events:none",
      "z-index:2147483647",
      "font-family:ui-monospace,SFMono-Regular,Menlo,monospace",
      // An outline, not a border: it draws over the viewport instead of adding
      // to it, so the frame needs no box-sizing to stay inside `inset:0`.
      `outline:3px solid ${o.accent}`,
      "outline-offset:-3px",
    ].join(";");

    const badge = document.createElement("div");
    badge.style.cssText = [
      "position:absolute",
      "top:0",
      "left:0",
      `background:${o.accent}`,
      "color:#04070a",
      "padding:5px 12px 6px",
      "font-weight:700",
      "letter-spacing:0.06em",
      "font-size:15px",
      "line-height:1.15",
    ].join(";");
    const sub = document.createElement("div");
    sub.textContent = o.subtitle;
    sub.style.cssText = "font-weight:500;font-size:11px;opacity:0.8";
    badge.textContent = o.title;
    badge.append(sub);

    const clock = document.createElement("div");
    clock.style.cssText = [
      "position:absolute",
      "top:0",
      "left:50%",
      "transform:translateX(-50%)",
      "background:rgba(4,7,10,0.88)",
      `color:${o.accent}`,
      "padding:6px 14px",
      "font-size:20px",
      "font-weight:700",
      "letter-spacing:0.08em",
      `border:1px solid ${o.accent}`,
      "border-top:none",
    ].join(";");

    const caption = document.createElement("div");
    caption.id = "__scene-caption";
    caption.style.cssText = [
      "position:absolute",
      "left:0",
      "right:0",
      "bottom:0",
      "background:rgba(4,7,10,0.92)",
      "color:#e8f2ff",
      "padding:10px 14px",
      "font-size:15px",
      "line-height:1.3",
      "min-height:22px",
      `border-top:2px solid ${o.accent}`,
    ].join(";");

    root.append(badge, clock, caption);
    document.body.append(root);

    const pad = (n: number, width = 2) => String(n).padStart(width, "0");
    /*
     * A fifty-millisecond timer, and the DOM is only touched when the reading
     * actually changes.
     *
     * `requestAnimationFrame` is the obvious way to draw a clock and it is the
     * wrong one here. It turns three otherwise-static pages into three pages
     * repainting sixty times a second, and Chromium's screencast emits a frame
     * per repaint: the recorder fell far enough behind the wall that the panes
     * could no longer be aligned at all. The instrument was distorting its own
     * subject, and at a resolution nobody can read anyway.
     */
    let shown = "";
    const tick = () => {
      const ms = Date.now() - o.epoch;
      const sign = ms < 0 ? "-" : "+";
      const abs = Math.abs(ms);
      const next = `T${sign}${pad(Math.floor(abs / 60000))}:${pad(
        Math.floor(abs / 1000) % 60,
      )}.${Math.floor(abs / 100) % 10}`;
      if (next !== shown) {
        shown = next;
        clock.textContent = next;
      }
    };
    tick();
    setInterval(tick, 50);
  }, opts);
}

/** Put `text` on every pane's caption strip at once. */
export async function caption(
  screens: readonly Screen[],
  text: string,
): Promise<void> {
  await Promise.all(
    screens.map((screen) =>
      screen.page.evaluate((t: string) => {
        const el = document.getElementById("__scene-caption");
        if (el) el.textContent = t;
      }, text),
    ),
  );
}

/**
 * Say something, hold it long enough to read, and leave it up.
 *
 * The hold is the point. The delay ARITHMETIC is the subject and is never
 * paced, but everything around it is: a reviewer who cannot read the caption
 * before the state it describes has changed has been shown nothing.
 */
export async function beat(
  screens: readonly Screen[],
  text: string,
  holdMs = HOLD_MS,
): Promise<void> {
  await caption(screens, text);
  await screens[0].page.waitForTimeout(holdMs);
}

/* ------------------------------------------------------------------------- *
 * The film
 * ------------------------------------------------------------------------- */

/** Mono 16-bit PCM, wrapped as a WAV file ffmpeg will take on stdin's behalf. */
export function wavFile(pcm: Int16Array, sampleRate: number): Buffer {
  const data = Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength);
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  // 1 = uncompressed PCM, 1 channel.
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

/**
 * One screen's tape laid out on the film's clock: silence, then what it heard,
 * where it heard it.
 *
 * Every block is placed at its OWN wall instant rather than butted against the
 * one before, which is the whole point: the silence between the key going down
 * and the first word is a light-time, and a track that simply concatenated what
 * was decoded would erase exactly the thing the film is about.
 *
 * The one liberty taken is a cursor that never runs backwards. A playout that
 * delivers two blocks inside the same millisecond is a real thing (the buffer
 * releases on a clock the engine can stall), and placing the second on top of
 * the first would DROP audio the code produced. Butting it on instead delays it
 * by 20 ms and keeps it.
 *
 * A screen that heard NOTHING still gets a track, and it is silent for its
 * whole length rather than absent. A pane whose audio was simply left out of
 * the mux would say "nobody spoke to me" with the same silence as a pane whose
 * audio the harness failed to collect.
 */
export function trackFor(
  blocks: readonly TapedBlock[],
  fromMs: number,
  seconds: number,
  sampleRate: number,
): Int16Array {
  const pcm = new Int16Array(Math.ceil(seconds * sampleRate));
  let cursor = 0;
  for (const block of blocks) {
    const bytes = Buffer.from(block.pcm, "base64");
    const samples = new Int16Array(
      bytes.buffer,
      bytes.byteOffset,
      bytes.byteLength / 2,
    );
    const at = Math.max(
      cursor,
      Math.round(((block.at - fromMs) / 1000) * sampleRate),
    );
    if (at >= pcm.length) break;
    pcm.set(samples.subarray(0, pcm.length - at), at);
    cursor = at + samples.length;
  }
  return pcm;
}

/**
 * Where a pane's audio sits in the stereo field: left to right, in the order
 * the panes are stacked.
 *
 * Constant-power rather than linear, so three voices at the same level stay at
 * the same level wherever they are panned. It is not decoration: two screens
 * hear the same utterance seconds apart, and a listener told which side each
 * pane is on can follow that with the picture off.
 */
export function panGains(index: number, count: number): [number, number] {
  const at = count <= 1 ? 0.5 : index / (count - 1);
  return [Math.sqrt(1 - at), Math.sqrt(at)];
}

/**
 * Stack every screen's recording into one mp4, side by side, each pane carrying
 * the audio that screen's own decoder produced.
 *
 * Soft: a runner with no ffmpeg still runs the assertions, and says why there
 * is no film rather than failing a timing test over a codec.
 */
export async function stackVideos(
  screens: readonly Screen[],
  testInfo: TestInfo,
  opts: { epoch?: number; fileName?: string; endedAt?: number } = {},
): Promise<string | null> {
  const clips: { path: string; skipSeconds: number }[] = [];
  /*
   * Everything is trimmed back to the LAST screen to open, so the panes share
   * one wall clock. A stacked film whose panes start seconds apart would put
   * the boot sequence into the picture and show a light-time as something else
   * entirely, which is the exact misreading a video is here to prevent.
   */
  const commonStart =
    opts.epoch ?? Math.max(...screens.map((s) => s.recordingFrom));
  for (const screen of screens) {
    const video = screen.page.video();
    if (video) {
      clips.push({
        path: await video.path(),
        skipSeconds: Math.max(0, (commonStart - screen.recordingFrom) / 1000),
      });
    }
  }
  const paths = clips.map((c) => c.path);
  /*
   * Contexts are closed by the caller before this runs: a video is only
   * finalised on close, and `path()` on a live recording names a file that is
   * still being written.
   */
  if (paths.length === 0) return null;
  const out = testInfo.outputPath(opts.fileName ?? "radio-scene.mp4");
  await mkdir(dirname(out), { recursive: true });

  /*
   * One length for every track, so the panes stay locked together: ffmpeg pads
   * nothing for us, and a short track would slide the next input's audio
   * forward relative to its own picture. Ends at the last thing anybody heard
   * plus the tail hold, which is where the film ends anyway.
   */
  const lastHeard = Math.max(
    commonStart,
    /*
     * The end of the SCENE, not merely of the audio. The last beat is a held
     * frame on quiet screens, which is the whole point of holding it, and a
     * film cut at the last decoded chunk ends two seconds into the silence it
     * was supposed to end on.
     */
    opts.endedAt ?? 0,
    ...screens.flatMap((s) => s.audio.map((b) => b.at)),
  );
  const trackSeconds = (lastHeard - commonStart) / 1000 + HOLD_MS / 1000;
  /*
   * Whatever the decoders said they were writing at, off any screen that heard
   * something. The fallback is only ever reached when NO screen decoded a
   * chunk, in which case every track is silence and the rate cannot be wrong
   * about anything.
   */
  const sampleRate =
    screens.flatMap((s) => s.audio).find((b) => b.sampleRate > 0)?.sampleRate ??
    48_000;
  const tracks: string[] = [];
  for (const screen of screens) {
    const path = testInfo.outputPath(`radio-${screen.name}.wav`);
    await writeFile(
      path,
      wavFile(
        trackFor(screen.audio, commonStart, trackSeconds, sampleRate),
        sampleRate,
      ),
    );
    tracks.push(path);
    /*
     * Attached individually as well as muxed. One screen's decoded audio is a
     * reading in its own right and a reviewer may want to open it alone; the
     * muxed film is for hearing the vantages against each other.
     */
    await testInfo.attach(`radio-audio-${screen.name}`, {
      path,
      contentType: "audio/wav",
    });
  }
  // One per pane, always: the pan positions are computed off the pane order, so
  // a missing track would move every voice after it to the wrong side.
  const withAudio = tracks.length === paths.length;

  const graph: string[] = [];
  if (paths.length > 1) {
    graph.push(
      `${paths.map((_, i) => `[${i}:v]`).join("")}hstack=inputs=${paths.length}[v]`,
    );
  }
  if (withAudio) {
    tracks.forEach((_, i) => {
      const [left, right] = panGains(i, tracks.length);
      graph.push(
        `[${paths.length + i}:a]pan=stereo|c0=${left.toFixed(3)}*c0|c1=${right.toFixed(3)}*c0[a${i}]`,
      );
    });
    /*
     * Summed un-normalised, then limited. `normalize=1` would divide every
     * voice by the number of panes, so a scene with three screens would play
     * quieter than the same scene with two and the loudness of a pane would be
     * a property of the harness. The limiter is there because two people
     * talking at once is a beat some scenes stage deliberately, and two clips
     * that each peak near full scale sum past it: without one the ONE moment
     * the film exists to let you hear would be the one moment it clips.
     */
    graph.push(
      `${tracks.map((_, i) => `[a${i}]`).join("")}amix=inputs=${tracks.length}:normalize=0,alimiter=limit=0.85[a]`,
    );
  }

  try {
    await execFileAsync("ffmpeg", [
      "-y",
      ...clips.flatMap((c) => ["-ss", c.skipSeconds.toFixed(3), "-i", c.path]),
      ...tracks.flatMap((t) => ["-i", t]),
      ...(graph.length > 0 ? ["-filter_complex", graph.join(";")] : []),
      "-map",
      paths.length > 1 ? "[v]" : "0:v",
      ...(withAudio ? ["-map", "[a]", "-c:a", "aac", "-b:a", "128k"] : []),
      /*
       * Ends where the SCENE ends, not where the recorder stopped. A context is
       * only closed after the last assertion, and the teardown that follows is
       * recorded like everything else: without this the film ran five and a
       * half minutes, of which three were three dead screens.
       */
      "-t",
      trackSeconds.toFixed(3),
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      "-movflags",
      "+faststart",
      out,
    ]);
    await testInfo.attach(opts.fileName ?? "radio-scene", {
      path: out,
      contentType: "video/mp4",
    });
    console.info(
      `[radio] stacked video: ${out}` +
        (withAudio
          ? ` (with ${tracks.length} decoded audio track${tracks.length === 1 ? "" : "s"})`
          : " (no audio: a pane had no recording to pair a track with)"),
    );
    return out;
  } catch (err) {
    console.warn(
      `[radio] no stacked video (${(err as Error).message.split("\n")[0]}). ` +
        `The per-screen webm recordings are still under ${testInfo.outputDir}.`,
    );
    return null;
  }
}

export async function closeAll(screens: readonly Screen[]): Promise<void> {
  /*
   * Every tape is taken off while every page is still up, and only then is
   * anything closed.
   *
   * The order is load-bearing and was found the hard way. Closing a screen at a
   * time works until the HOST is one of them: the moment its page goes, every
   * remaining peer starts reconnecting, and `PeerClientService` retries hard
   * enough to saturate the page's own main thread. A `page.evaluate` issued
   * against a peer in that state does not come back, so a teardown that read
   * the last screen's audio after closing the host hung for as long as the test
   * had left and took the film down with it, having already recorded
   * everything the film was for.
   */
  for (const screen of screens) {
    await screen.page.evaluate(() => {
      const stop = (window as unknown as Record<string, unknown>)
        .__radioWatchStop as (() => void) | undefined;
      stop?.();
    });
    // Off the page while there still IS one: the tape lives in the page, and a
    // closed context takes it with it.
    screen.audio = await takeAudio(screen.page);
  }
  await Promise.all(screens.map((screen) => screen.page.close()));
  /* Contexts one at a time: closing a context finalises its recording and
     flushes whatever artifacts it owes, and three doing that into one output
     directory at once is a race with nothing to gain. */
  for (const screen of screens) await screen.context.close();
}
