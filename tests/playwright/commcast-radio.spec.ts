import { execFile } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { promisify } from "node:util";
import type { Browser, BrowserContext, Page, TestInfo } from "@playwright/test";
import { expect, test } from "@playwright/test";
import { PORTS } from "../../playwright.config";
import { dashboardWithWidget, getHostPeerId, seedContext } from "./helpers";

/**
 * Two and three real screens, keying a real radio at each other over the real
 * mesh, and hearing each other one light-time later.
 *
 * **Every radio test before this one exercised ONE side.** `RadioSession` runs
 * against a stub, `clips.roundtrip` compares sample for sample, `RadioPtt`
 * renders alone, and the render harness mounts two panes whose logs are seeded
 * rather than connected. So the delay model's central claim, that a
 * transmission is due at DIFFERENT wall instants at different vantages, was
 * structurally invisible: one side cannot disagree with itself about when it
 * is.
 *
 * What is real here: the widget, the composer, the push-to-talk key, the
 * transmitter, `CommcastMesh` over PeerJS, `CommcastLog`, `RadioSession`, the
 * delayed playout buffer, the pacer, and each screen's own view clock. What is
 * substituted is the microphone and the codec, through the seam `backend.ts`
 * was built to offer and `InjectedRadioBackend` finally provides: a recorded
 * clip in, a recording sink out, on both ends.
 *
 * ## The three screens, and why there are three
 *
 * Two screens can only show a light-time being SYMMETRIC, because a separation
 * is. The sentence worth proving is that ONE transmission is due at two
 * different instants, and that needs a third vantage:
 *
 *   - mission control at `ksc`, hosting the mesh, on `/`
 *   - a pilot 3 s away at `vessel:near`, on `/pilot`
 *   - a pilot 9 s away at `vessel:far`, on `/pilot`
 *
 * Radio is a BROADCAST in this model: `RadioSession.begin` registers any
 * transmission it has a path to, and never asks whether this vantage was
 * addressed. So mission control keying once is heard by both craft, six
 * seconds apart, off the same bytes.
 *
 * ## The light, and the leak it must not have
 *
 * `RadioReception.live` is populated only when a chunk is PRESENTED, never on
 * the `start` frame, because `start` crosses at the speed of the internet: a
 * lamp lit by the envelope would announce a speaker a light-minute before
 * their first word. That is asserted here in the only place it can be, with a
 * real wire under it, and it is planted in both directions rather than
 * assumed:
 *
 *   - it must be DARK while the words are crossing, with the transmitter
 *     provably already talking
 *   - it must not be dark merely because nothing arrived. The far end decodes
 *     the utterance from CHUNK ZERO, in order, in about the wall time the clip
 *     lasts, after a silence several times longer: audio that was held and
 *     released, which a wire that only woke up late cannot produce
 *   - and the second test is the strongest plant of all. If the lamp were lit
 *     by the envelope, both craft would light together; they light six seconds
 *     apart, which no internet hop explains
 *
 * ## The video
 *
 * Recorded per screen (`video: "on"`) and stacked side by side into one mp4,
 * attached to the run. A timing failure is a thing you SEE: a jittered
 * playout, a lamp that lights before the words could have arrived, a
 * transmission that fades at the wrong instant. It is deliberately NOT routed
 * through the `visual` job, which diffs deterministic stills and is a
 * different instrument entirely.
 */

const execFileAsync = promisify(execFile);

/** Vantage ids, matching the three servers `playwright.config.ts` launches. */
const KSC = "ksc";
const NEAR = "vessel:near";
const FAR = "vessel:far";

/** One-way seconds between mission control and each craft. */
const NEAR_SECONDS = 3;
const FAR_SECONDS = 9;
/** Craft to craft, so the matrix is complete rather than only useful. */
const NEAR_FAR_SECONDS = 7;

const NAMES: Record<string, string> = {
  [KSC]: "Mission Control",
  [NEAR]: "Near Craft",
  [FAR]: "Far Craft",
};

/** Each screen renders at this size, so the stacked video tiles evenly. */
const SCREEN_SIZE = { width: 760, height: 460 } as const;

/**
 * A second of somebody talking, at 20 ms a chunk.
 *
 * `LONG_CLIP` rather than `SHORT_CLIP` because the scene is about a gap: half
 * a second of speech under a nine-second crossing is a blink on the video and
 * leaves too few chunks for "the whole utterance arrived in order" to mean
 * much.
 */
const CLIP = "LONG_CLIP";
const CLIP_CHUNKS = 50;
const CLIP_SECONDS = 1;

interface ReceptionWatch {
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
  /** Chunks this screen's own microphone has put on the wire. */
  spoken: number;
}

interface Screen {
  name: string;
  context: BrowserContext;
  page: Page;
  /** Wall ms the recording started, so the stacked film can be aligned. */
  recordingFrom: number;
}

/** One frame the fixture stream is holding for every screen. */
interface SceneFrame {
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
function scene(): SceneFrame[] {
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

async function publishScene(ports: readonly number[]): Promise<void> {
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

/**
 * Runs this page's radio on a recorded clip.
 *
 * The clip module is reached through the DEV SERVER's own module URL rather
 * than bundled into the app: the seam takes a backend the page hands it, so
 * nothing about a stand-in microphone is in the app's module graph, and what
 * loads here is the same `clips.ts` the jsdom suites use.
 */
async function installClipRadio(page: Page): Promise<void> {
  await page.evaluate(async (clipName: string) => {
    const clips = (await import(
      /* @vite-ignore */ "/src/commcast/radio/clips.ts"
    )) as Record<string, unknown> & {
      clipRadio: (clip: unknown) => unknown;
    };
    const radio = clips.clipRadio(clips[clipName]);
    const holder = window as unknown as Record<string, unknown>;
    holder.__gonogoClipRadio = radio;
    holder.__gonogoRadioBackend = (radio as { backend: unknown }).backend;
    window.dispatchEvent(new Event("gonogo:radio-backend"));
  }, CLIP);
  /*
   * The swap tears down the real session and stands a fresh one up, and the
   * listening chain is what says it landed: `useRadio` builds exactly one
   * decoder per session, off the backend it was handed, so a decoder existing
   * here means this screen is hearing through the clip rather than through
   * WebCodecs. Waiting on the KEY instead would not do: the key lives in the
   * composer, which only exists inside a conversation, and a receiving screen
   * never opens one.
   */
  await page.waitForFunction(
    () =>
      (
        (window as unknown as Record<string, unknown>).__gonogoClipRadio as
          | { decoders: unknown[] }
          | undefined
      )?.decoders.length !== 0,
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
async function watchReception(page: Page): Promise<void> {
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

async function reception(page: Page): Promise<ReceptionWatch> {
  return (await page.evaluate(() => {
    const holder = window as unknown as Record<string, unknown>;
    const watch = holder.__radioWatch as Omit<
      ReceptionWatch,
      "decoded" | "spoken"
    >;
    const radio = holder.__gonogoClipRadio as
      | {
          decoders: { decoded: { index: number }[] }[];
          mic: { spoken: number };
        }
      | undefined;
    return {
      ...watch,
      decoded: (radio?.decoders ?? []).flatMap((d) =>
        d.decoded.map((c) => c.index),
      ),
      decoderLengths: (radio?.decoders ?? []).map((d) => d.decoded.length),
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
async function waitForReception(
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
async function openConversation(page: Page, name: string): Promise<void> {
  await page.getByRole("button", { name: "New message" }).click();
  /*
   * A list ROW, never a control that happens to carry the same words: every
   * row is a toggle and so carries `aria-pressed`, which the station-name
   * editor in the panel header does not.
   */
  await page.locator("button[aria-pressed]").filter({ hasText: name }).click();
  await page.getByRole("button", { name: "Open" }).click();
}

/** Latch the key and return the wall instant it caught, read on the page. */
async function keyDown(page: Page): Promise<number> {
  await page.getByRole("button", { name: "Transmit" }).click();
  await expect(
    page.getByRole("button", { name: "Stop transmitting" }),
  ).toBeVisible();
  return await page.evaluate(() => Date.now());
}

async function keyUp(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Stop transmitting" }).click();
}

/**
 * Speak the clip at the grid it was recorded on, and return immediately.
 *
 * At natural rate rather than in one go, because the scene is a measurement of
 * WHEN: a whole clip emitted in one tick would be a single instant on the wire
 * and would tell you nothing about a playout, and on the video it would be a
 * flash rather than somebody talking.
 */
async function speak(page: Page): Promise<void> {
  await page.evaluate(() => {
    const radio = (window as unknown as Record<string, unknown>)
      .__gonogoClipRadio as { mic: { speak: () => boolean } };
    const timer = setInterval(() => {
      if (!radio.mic.speak()) clearInterval(timer);
    }, 20);
  });
}

async function openScreen(
  browser: Browser,
  opts: {
    name: string;
    url: string;
    dashboardKey: "gonogo:dashboard:main" | "gonogo:dashboard:station";
    sitrepPort: number;
    videoDir: string;
  },
): Promise<Screen> {
  const context = await browser.newContext({
    viewport: { ...SCREEN_SIZE },
    recordVideo: { dir: opts.videoDir, size: { ...SCREEN_SIZE } },
  });
  await seedContext(
    context,
    opts.dashboardKey,
    /*
     * Tall enough that the composer bar, and therefore the key and the lamp,
     * are on screen without scrolling: a control the video cannot see is a
     * control the reviewer cannot check.
     */
    dashboardWithWidget("commcast", { size: { w: 12, h: 9 } }),
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
  await expect(page.getByText("Commcast").first()).toBeVisible();
  await installClipRadio(page);
  await watchReception(page);
  return { name: opts.name, context, page, recordingFrom };
}

/**
 * Stack every screen's recording into one mp4, side by side.
 *
 * Soft: a runner with no ffmpeg still runs the assertions, and says why there
 * is no film rather than failing a timing test over a codec.
 */
async function stackVideos(
  screens: readonly Screen[],
  testInfo: TestInfo,
): Promise<void> {
  const clips: { path: string; skipSeconds: number }[] = [];
  /*
   * Everything is trimmed back to the LAST screen to open, so the three panes
   * share one wall clock. A stacked film whose panes start seconds apart would
   * put the boot sequence into the picture and show a six-second gap as
   * something else entirely, which is the exact misreading a video is here to
   * prevent.
   */
  const commonStart = Math.max(...screens.map((s) => s.recordingFrom));
  for (const screen of screens) {
    const video = screen.page.video();
    if (video) {
      clips.push({
        path: await video.path(),
        skipSeconds: (commonStart - screen.recordingFrom) / 1000,
      });
    }
  }
  const paths = clips.map((c) => c.path);
  /*
   * Contexts are closed by the caller before this runs: a video is only
   * finalised on close, and `path()` on a live recording names a file that is
   * still being written.
   */
  if (paths.length === 0) return;
  const out = testInfo.outputPath("radio-scene.mp4");
  await mkdir(dirname(out), { recursive: true });
  const filter =
    paths.length === 1
      ? null
      : `${paths.map((_, i) => `[${i}:v]`).join("")}hstack=inputs=${paths.length}[v]`;
  try {
    await execFileAsync("ffmpeg", [
      "-y",
      ...clips.flatMap((c) => ["-ss", c.skipSeconds.toFixed(3), "-i", c.path]),
      ...(filter ? ["-filter_complex", filter, "-map", "[v]"] : []),
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      "-movflags",
      "+faststart",
      out,
    ]);
    await testInfo.attach("radio-scene", {
      path: out,
      contentType: "video/mp4",
    });
    console.info(`[radio] stacked video: ${out}`);
  } catch (err) {
    console.warn(
      `[radio] no stacked video (${(err as Error).message.split("\n")[0]}). ` +
        `The per-screen webm recordings are still under ${testInfo.outputDir}.`,
    );
  }
}

async function closeAll(screens: readonly Screen[]): Promise<void> {
  for (const screen of screens) {
    await screen.page.evaluate(() => {
      const stop = (window as unknown as Record<string, unknown>)
        .__radioWatchStop as (() => void) | undefined;
      stop?.();
    });
    await screen.page.close();
    await screen.context.close();
  }
}

// Recorded for every run: the film IS the deliverable here, not a failure
// artifact, and a timing defect is far easier to see than to reason back from.
test.use({ video: "on" });

// Three page loads, a peer handshake each, and a nine-second crossing to wait
// out. The default 60 s is not enough and the slowness is the subject.
test.describe.configure({ timeout: 180_000 });

/**
 * Chromium only, and MEASURED rather than assumed.
 *
 * On chromium this is steady: three consecutive runs put the near craft at
 * 3.03 s and the far one at 9.03, 9.03 and 9.04 against separations of 3 and 9.
 * On firefox the three-screen measurement passed twice at +3.04 / +9.04, and
 * the two-screen one hears nothing at all in three runs out of four: the craft
 * boots, joins the mesh and renders, and the audio never arrives. That is a
 * peer-establishment flake between two fresh firefox contexts rather than
 * anything the radio owns, and a timing measurement that silently loses its
 * subject is worse than one that does not run. Webkit is untried.
 *
 * The delay ARITHMETIC is engine-independent and covered per engine already;
 * what is scoped here is the three-context WebRTC scene it is measured over.
 */
test.describe("commcast radio: two screens hearing each other @chromium-only", () => {
  test("mission control keys, and the craft hears it one light-time later", async ({
    browser,
  }, testInfo) => {
    await publishScene([PORTS.radioStream.ksc, PORTS.radioStream.near]);

    const videoDir = testInfo.outputPath("videos");
    const control = await openScreen(browser, {
      name: "mission-control",
      url: "/?uplinkLoaderIds=",
      dashboardKey: "gonogo:dashboard:main",
      sitrepPort: PORTS.radioStream.ksc,
      videoDir,
    });
    const shareCode = await getHostPeerId(control.page);
    const craft = await openScreen(browser, {
      name: "near-craft",
      url: `/pilot?host=${shareCode}&uplinkLoaderIds=`,
      dashboardKey: "gonogo:dashboard:main",
      sitrepPort: PORTS.radioStream.near,
      videoDir,
    });
    const screens = [control, craft];

    try {
      await openConversation(control.page, NAMES[NEAR]);
      const keyedAt = await keyDown(control.page);
      await speak(control.page);

      /*
       * A second and a bit in: the transmitter is provably mid-sentence and the
       * craft has been told nothing. That pairing is the assertion, not either
       * half of it. A dark lamp on its own is what a broken wire looks like,
       * and a talking transmitter on its own says nothing about the far end.
       */
      await control.page.waitForTimeout(1_200);
      const early = await reception(craft.page);
      const sending = await reception(control.page);
      expect(
        sending.spoken,
        "mission control should be mid-sentence by now",
      ).toBeGreaterThan(30);
      expect(early.firstDecodeAt, "the words have not arrived yet").toBeNull();
      expect(
        early.litAt,
        "and the lamp must not announce a speaker before their first word",
      ).toBeNull();

      // Keying up does not silence what is still crossing: `end` travels at the
      // speed of the internet while the words it ends are still in flight.
      await control.page.waitForTimeout(200);
      await keyUp(control.page);

      await waitForReception(craft.page, (r) => r.firstDecodeAt !== null, {
        timeout: 30_000,
        message: "the craft never heard the transmission",
      });
      // Long enough for the whole utterance to play out at natural rate.
      await craft.page.waitForTimeout(2_000);
      const heard = await reception(craft.page);

      const crossing = (heard.firstDecodeAt as number) - keyedAt;
      console.info(
        `[radio] near craft first heard ${(crossing / 1000).toFixed(2)}s after key-down (separation ${NEAR_SECONDS}s)`,
      );
      // Generous on both sides: the key catches a frame or two after the click,
      // and the clock is anchored on a stream re-emitting at 200 ms. Tight
      // enough that a missing delay (0 s) and a doubled one (6 s) both fail.
      expect(crossing).toBeGreaterThan(NEAR_SECONDS * 1000 - 800);
      expect(crossing).toBeLessThan(NEAR_SECONDS * 1000 + 1_500);

      /*
       * The other direction of the plant. The craft heard the utterance from
       * CHUNK ZERO, in order, and played it out in about the second it lasts,
       * after three seconds of silence: audio that was HELD and released on a
       * clock. A wire that had simply been dead for those three seconds would
       * have lost its opening chunks, and a lamp lit by the envelope would have
       * lit before any of this.
       */
      expect(heard.decoded).toEqual(
        Array.from({ length: CLIP_CHUNKS }, (_, i) => i),
      );
      /*
       * ONE listening chain took the whole utterance. Worth asserting
       * separately from the sequence above because the two failures look alike
       * in it: a session rebuilt mid-transmission SPLITS the clip across two
       * chains, and a duplicate delivery decodes every chunk twice. The second
       * of those is not hypothetical, it is what this scene found on its first
       * run, and `PilotScreen` now disconnects its peer on teardown because of
       * it.
       */
      expect(heard.decoderLengths).toEqual([CLIP_CHUNKS]);
      const playout =
        (heard.lastDecodeAt as number) - (heard.firstDecodeAt as number);
      expect(playout).toBeGreaterThan(CLIP_SECONDS * 1000 * 0.5);
      expect(playout).toBeLessThan(CLIP_SECONDS * 1000 * 2.5);

      // The lamp went dark again once the audio it named had finished, rather
      // than at the `end` frame that arrived seconds earlier.
      expect(heard.darkAt).not.toBeNull();
      expect(
        (heard.darkAt as number) - (heard.litAt as number),
      ).toBeGreaterThan(CLIP_SECONDS * 1000 * 0.5);

      // Nobody hears their own voice back off the relay, which is what
      // `authorStationKey` is repeated on every frame for.
      const selfHeard = await reception(control.page);
      expect(selfHeard.decoded).toEqual([]);
      expect(selfHeard.litAt).toBeNull();
    } finally {
      await closeAll(screens);
      await stackVideos(screens, testInfo);
    }
  });

  test("one transmission, two craft, two different wall instants", async ({
    browser,
  }, testInfo) => {
    await publishScene([
      PORTS.radioStream.ksc,
      PORTS.radioStream.near,
      PORTS.radioStream.far,
    ]);

    const videoDir = testInfo.outputPath("videos");
    const control = await openScreen(browser, {
      name: "mission-control",
      url: "/?uplinkLoaderIds=",
      dashboardKey: "gonogo:dashboard:main",
      sitrepPort: PORTS.radioStream.ksc,
      videoDir,
    });
    const shareCode = await getHostPeerId(control.page);
    const near = await openScreen(browser, {
      name: "near-craft",
      url: `/pilot?host=${shareCode}&uplinkLoaderIds=`,
      dashboardKey: "gonogo:dashboard:main",
      sitrepPort: PORTS.radioStream.near,
      videoDir,
    });
    const far = await openScreen(browser, {
      name: "far-craft",
      url: `/pilot?host=${shareCode}&uplinkLoaderIds=`,
      dashboardKey: "gonogo:dashboard:main",
      sitrepPort: PORTS.radioStream.far,
      videoDir,
    });
    const screens = [near, control, far];

    try {
      // Addressed to the near craft. The far craft is not a recipient and hears
      // it anyway, because radio is a broadcast: a session registers any
      // transmission it has a path to and never asks whether it was addressed.
      await openConversation(control.page, NAMES[NEAR]);
      const keyedAt = await keyDown(control.page);
      await speak(control.page);
      await control.page.waitForTimeout(CLIP_SECONDS * 1000 + 300);
      await keyUp(control.page);

      for (const craft of [near, far]) {
        await waitForReception(craft.page, (r) => r.firstDecodeAt !== null, {
          timeout: 40_000,
          message: `${craft.name} never heard the transmission`,
        });
      }
      // Let the far craft finish playing what it was still holding.
      await far.page.waitForTimeout(2_000);

      const nearHeard = await reception(near.page);
      const farHeard = await reception(far.page);
      const nearAt = (nearHeard.firstDecodeAt as number) - keyedAt;
      const farAt = (farHeard.firstDecodeAt as number) - keyedAt;
      console.info(
        `[radio] one keying, heard at +${(nearAt / 1000).toFixed(2)}s (near, ${NEAR_SECONDS}s) and +${(farAt / 1000).toFixed(2)}s (far, ${FAR_SECONDS}s)`,
      );

      expect(nearAt).toBeGreaterThan(NEAR_SECONDS * 1000 - 800);
      expect(nearAt).toBeLessThan(NEAR_SECONDS * 1000 + 1_500);
      expect(farAt).toBeGreaterThan(FAR_SECONDS * 1000 - 800);
      expect(farAt).toBeLessThan(FAR_SECONDS * 1000 + 1_500);

      /*
       * The whole claim in one line, and the strongest plant against a lamp lit
       * by the envelope: `start` reaches both craft in the same internet
       * millisecond, so an envelope-driven light would put this difference at
       * roughly zero. It is six seconds.
       */
      const gap = farAt - nearAt;
      expect(gap).toBeGreaterThan((FAR_SECONDS - NEAR_SECONDS) * 1000 - 1_000);
      expect(gap).toBeLessThan((FAR_SECONDS - NEAR_SECONDS) * 1000 + 1_000);

      // The SAME audio, arriving at two different times: identical chunk
      // sequences, from the same keying, decoded independently at two vantages.
      const wholeClip = Array.from({ length: CLIP_CHUNKS }, (_, i) => i);
      expect(nearHeard.decoded).toEqual(wholeClip);
      expect(farHeard.decoded).toEqual(wholeClip);
    } finally {
      await closeAll(screens);
      await stackVideos(screens, testInfo);
    }
  });
});
