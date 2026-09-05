import { ScreenProvider } from "@ksp-gonogo/core";
import {
  harnessTheme,
  installRealTestHost,
  type StreamFixture,
  setupStreamFixture,
} from "@ksp-gonogo/sitrep-sdk/testing";
import {
  AugmentSlot,
  clearAugments,
  getAugmentsForSlot,
  registerAugment,
  setQuantityLocale,
} from "@ksp-gonogo/ui-kit";
import { createRoot, type Root } from "react-dom/client";
import { ThemeProvider } from "styled-components";
import { CommcastWidget } from "../../src/commcast/CommcastComponent";
import { CommcastLog } from "../../src/commcast/CommcastLog";
import { CommcastLogProvider } from "../../src/commcast/CommcastLogContext";
import { RadioBackendProvider } from "../../src/commcast/radio/backend";
import type { ClipRadio } from "../../src/commcast/radio/clips";
import { clipRadio, SHORT_CLIP } from "../../src/commcast/radio/clips";
import type { CommsAck, CommsMessage } from "../../src/commcast/types";
import {
  StationIdentityProvider,
  StationIdentityService,
} from "../../src/stationIdentity";

/**
 * Browser entry for the Commcast render harness. esbuild bundles it into
 * `commcast-probe.html`, and `scripts/render-commcast.ts` drives it through
 * `window.__renderCommcast`, screenshotting `#root`.
 *
 * Two panes over TWO LOGS is the whole reason this exists. Commcast has no
 * canonical thread: a vantage owns what reached it, so a scene mounts one log
 * per pane and seeds each with what that vantage actually holds. The two panes
 * then disagree on screen the way the two operators would, including about
 * which messages exist at all.
 *
 * It lives app-side rather than in `packages/components`' probe because the
 * widget registers in `@ksp-gonogo/app`, which that package must not import.
 */

installRealTestHost({
  AugmentSlot,
  clearAugments,
  getAugmentsForSlot,
  registerAugment,
});

// Pin the locale every quantity is written in: it defaults to the reader's,
// which is right for an operator and wrong for a render that has to look the
// same on every machine. Same reasoning as the settings probe.
setQuantityLocale("en-GB");

/** UT the whole harness calls "now". Every scene's clock is anchored here. */
const VIEW_UT = 12_000_000;

/** One message a pane's log holds, in whichever direction. */
export interface Held {
  /** Where it was spoken from, and who it was addressed to. */
  from: string;
  to: string[];
  authorName: string;
  authorSeat: "pilot" | "mission-control";
  body: string;
  /** Relative to `VIEW_UT`; negative is in the past. */
  sentAt: number;
  /** Relative to `VIEW_UT`. Defaults to `sentAt`, differs after a resend. */
  lastSentAt?: number;
  attempts?: number;
  /** The author-to-recipient separation frozen at send. `null` is NO PATH. */
  separationSeconds: number | null;
  /** Acknowledgements this log has RECEIVED, each at the recipient's own UT. */
  acks?: { from: string; stationKey: string; at: number }[];
  /** Set on an outbound message that was never transmitted. */
  neverLeft?: boolean;
}

/** One vantage's view: its own screen, and its own log. */
export interface Pane {
  /** Drives `useSeat()`, and therefore which end of the light-path this is. */
  seat: "mission-control" | "pilot";
  /** The centre this session's frames were delayed from (`useObservedVantage`). */
  vantage?: string;
  /** What this screen posts (and is captioned) as. */
  name: string;
  /** What this vantage has SENT. Drawn as settled log rows or queue entries. */
  sent?: Held[];
  /** What has already ARRIVED here. */
  received?: Held[];
  /** Addressed here and still crossing. Shown nowhere, which is the point. */
  crossing?: Held[];
  /** Mount with no log at all, the other end of the empty state. */
  noLog?: boolean;
  /**
   * Open the conversation with this correspondent, by clicking its inbox row.
   *
   * Driven through the real row rather than by reaching into the widget's own
   * state: the widget opens on the inbox now, so a scene photographing a
   * conversation has to get there the way an operator does, and a harness with
   * a private door into a view is a harness that can photograph a state the UI
   * cannot actually reach.
   */
  openThread?: string;
  /** Click through to the recipient picker instead of opening a conversation. */
  compose?: boolean;
  /** Names to select in the picker, in order. Only read with `compose`. */
  pick?: string[];
  /** Press Open on what `pick` chose, landing in the conversation itself. */
  open?: boolean;
  /**
   * Latch the push-to-talk key, then speak a fixed clip through it.
   *
   * The real thing, driven by a real click on the real control: the transmitter
   * mints an envelope, freezes the separation and chunks the audio, and only
   * the microphone and the codec are stood in for. A render that reached into
   * the widget's state to paint an "on air" button would be photographing a
   * claim rather than the feature.
   */
  key?: boolean;
}

/**
 * Force the radio's capability verdict for a scene.
 *
 * The two refusals are the states an operator is likeliest to meet and the
 * hardest to photograph, because a machine that CAN run the radio never shows
 * either. They are also deliberately distinct: an insecure origin is something
 * the operator can act on (reach the page over https, or through localhost), a
 * missing codec is not, and the dev server binds the LAN so a station opened at
 * `http://<lan-ip>:5173` is in the first state every time.
 *
 * Forced by moving the globals `radioSupportStatus()` actually reads, so the
 * real detect runs and the render cannot go on being right about a verdict the
 * shipped code has stopped producing.
 */
export type RadioSupportOverride = "insecure-context" | "no-codec";

export interface Scene {
  panes: Pane[];
  /** Published vantage-to-vantage separations, one-way seconds. */
  separation?: { from: string; to: string; oneWaySeconds: number }[];
  /** Who each pane can address. */
  roster?: { id: string; displayName: string; active: boolean }[];
  /** `comms.delay`'s own path home, or omitted for a screen with no craft. */
  oneWaySeconds?: number;
  /** For the settle report, so an unsettled render names itself. */
  name: string;
  /**
   * Publish `comms.link` as CONFIRMED disconnected, so the log terminates with
   * its no-signal marker. Distinct from a message in transit: it says there
   * may be words this vantage has not heard, not that one specific utterance
   * is on its way.
   */
  linkLost?: boolean;
  /**
   * Text the scene is not settled until it renders, or several such.
   *
   * A list rather than one string because a scene can be about two things at
   * once: the no-path radio shot is only itself if the bar says NO PATH AND the
   * key still says On air, and a shot that lost either of them would go to a
   * reviewer reading as a design decision.
   */
  settleOn?: string | readonly string[];
  /** What this scene is a picture of, drawn above the panes. Harness furniture,
   *  never the widget's own words. */
  caption?: string;
  /** See {@link RadioSupportOverride}. */
  radioSupport?: RadioSupportOverride;
  pxW: number;
  pxH: number;
}

let root: Root | undefined;

function memoryStorage(): Storage {
  const m = new Map<string, string>();
  return {
    get length() {
      return m.size;
    },
    clear: () => m.clear(),
    key: (i: number) => [...m.keys()][i] ?? null,
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => {
      m.set(k, String(v));
    },
    removeItem: (k: string) => {
      m.delete(k);
    },
  } as Storage;
}

/**
 * The globals `radioSupportStatus()` consults, as this page found them.
 *
 * Captured once at module load, before any scene has moved them, so restoring
 * puts back what the engine shipped rather than what the previous scene left.
 */
const REAL_RADIO_GLOBALS = {
  isSecureContext: globalThis.isSecureContext,
  AudioEncoder: (globalThis as Record<string, unknown>).AudioEncoder,
  AudioDecoder: (globalThis as Record<string, unknown>).AudioDecoder,
};

/** Put this page into the capability state `want` names, or back to its own. */
function forceRadioSupport(want: RadioSupportOverride | undefined): void {
  Object.defineProperty(globalThis, "isSecureContext", {
    configurable: true,
    value:
      want === "insecure-context" ? false : REAL_RADIO_GLOBALS.isSecureContext,
  });
  for (const name of ["AudioEncoder", "AudioDecoder"] as const) {
    if (want === "no-codec") {
      delete (globalThis as Record<string, unknown>)[name];
      continue;
    }
    Object.defineProperty(globalThis, name, {
      configurable: true,
      writable: true,
      value: REAL_RADIO_GLOBALS[name],
    });
  }
}

function twoFrames(): Promise<void> {
  return new Promise((r) =>
    requestAnimationFrame(() => requestAnimationFrame(() => r())),
  );
}

/*
 * What each pane's log actually held on the last attempt, printed beside a
 * failed settle. It is the one fact that tells a probe defect (the log was
 * never seeded) from a widget one (it was, and nothing released), which a
 * screenshot of an empty console cannot.
 */
let lastLogCounts: Record<string, number>[] = [];

let nextId = 0;
function toMessage(held: Held): CommsMessage {
  nextId += 1;
  return {
    id: `probe-${nextId}`,
    to: held.to,
    from: held.from,
    authorStationKey: `author-${held.from}`,
    authorName: held.authorName,
    authorSeat: held.authorSeat,
    sentUt: VIEW_UT + held.sentAt,
    lastSentUt: VIEW_UT + (held.lastSentAt ?? held.sentAt),
    attempts: held.attempts ?? 1,
    separationSeconds: held.separationSeconds,
    kind: "text",
    body: held.body,
  };
}

/**
 * The MOUNT's text, never the document's.
 *
 * The probe page carries the whole bundle in an inline script, and a script
 * element's text is part of `document.body.textContent`, so a predicate looking
 * for a widget's own copy found it in the component's SOURCE and waited for a
 * condition that could never come true. Seven megabytes of body text against a
 * few hundred bytes of rendered widget is not a subtle margin.
 */
function mountedText(): string {
  return document.getElementById("root")?.textContent ?? "";
}

/** One pane's own subtree, so a click cannot reach the other vantage's widget. */
function paneEl(index: number): Element | null {
  return document.querySelector(`[data-pane="${index}"]`);
}

/**
 * The enabled button in `pane` whose label carries `text`, or `null`.
 *
 * Enabled matters: "New message" exists from the first frame and is refused
 * until the roster lands, so a harness that clicked the first match it saw
 * would click a dead control and then wait for a picker that never opened.
 *
 * `selector` narrows it to a kind of control. Every list row is a toggle and
 * so carries `aria-pressed`, which is what separates a correspondent's ROW
 * from the station-name editor that may be showing the same words up in the
 * panel header.
 */
function buttonIn(
  pane: Element,
  text: string,
  selector = "button",
): HTMLButtonElement | null {
  const found = [...pane.querySelectorAll<HTMLButtonElement>(selector)].find(
    (b) => !b.disabled && (b.textContent ?? "").includes(text),
  );
  return found ?? null;
}

/** A list row, never a control that happens to carry the same words. */
const ROW = "button[aria-pressed]";

/** Clicks `text` in `pane` once it is there to click. Returns whether it was. */
async function clickWhenReady(
  pane: Element,
  text: string,
  selector?: string,
): Promise<boolean> {
  const deadline = Date.now() + 3_000;
  while (Date.now() < deadline) {
    const button = buttonIn(pane, text, selector);
    if (button) {
      button.click();
      await twoFrames();
      await new Promise((r) => setTimeout(r, 16));
      return true;
    }
    await twoFrames();
    await new Promise((r) => setTimeout(r, 16));
  }
  return false;
}

/**
 * Walks one pane to the view its scene is about.
 *
 * The widget opens on the inbox, so every scene photographing a conversation
 * or the picker is a couple of real clicks in. What it does NOT do is fail
 * silently: a scene whose row never appeared reports it, because a screenshot
 * of an inbox where a conversation was expected reads as a design claim.
 */
async function drivePane(
  pane: Pane,
  index: number,
  radio: ClipRadio,
): Promise<boolean> {
  const el = paneEl(index);
  if (!el) return false;
  if (pane.compose === true) {
    if (!(await clickWhenReady(el, "New message"))) return false;
    for (const name of pane.pick ?? []) {
      if (!(await clickWhenReady(el, name, ROW))) return false;
    }
    if (pane.open === true && !(await clickWhenReady(el, "Open"))) return false;
  } else if (pane.openThread !== undefined) {
    if (!(await clickWhenReady(el, pane.openThread, ROW))) return false;
  }
  if (pane.key !== true) return true;
  /*
   * Latch, then talk. The click is what mints the envelope and freezes the
   * separation, and the clip only starts once the key has caught, so a shot of
   * a pressed key is a shot of a transmitter that really is transmitting.
   */
  if (!(await clickWhenReady(el, "Talk"))) return false;
  radio.mic.speakAll();
  await twoFrames();
  return true;
}

/**
 * Waits for a scene to actually settle, rather than for a fixed number of
 * frames to have gone by.
 *
 * Two frames was a race and lost: the arrival runs off the view clock's own
 * frame callback, and how many frames it takes depends on how many
 * subscriptions the widget opened and when each was acked, which moves when
 * the widget declares one more channel. Losing it renders a scene whose log is
 * empty and whose composer reads "No clock yet", which photographs as a design
 * claim rather than as a harness that ran early.
 *
 * `predicate` is what the scene is waiting to be true of the DOM. Frames, not
 * timers, so it stays on the same clock the arrival is on.
 */
async function settle(predicate: () => boolean): Promise<boolean> {
  /*
   * Short, because a scene that settles settles in well under a second and one
   * that lost the race does not recover on its own: what recovers it is a
   * fresh mount, which is `renderScene`'s job.
   */
  const deadline = Date.now() + 3_000;
  // Waits BEFORE the first check, so a scene with nothing to wait for still
  // gets a paint rather than being captured on the frame its predicate happened
  // to be vacuously true on.
  //
  // A frame pair AND a macrotask, because rAF alone is not enough. Headless
  // Chromium serves a tight rAF loop almost synchronously, so several hundred
  // callbacks can run through before React flushes the effects that push into
  // the arrival buffer at all: the loop then exhausts itself against a tree
  // that was never given a turn to advance. The timeout yields to the macrotask
  // queue those effects and the transport's own delivery run on.
  while (Date.now() < deadline) {
    await twoFrames();
    await new Promise((r) => setTimeout(r, 16));
    if (predicate()) {
      // One more pair, so the frame that satisfied the predicate has also been
      // painted with everything else it released alongside.
      await twoFrames();
      return true;
    }
  }
  return false;
}

/**
 * One pane: a real widget over its own stream session AND its own log.
 *
 * Each pane builds its own `TelemetryClient`, because the observed vantage is
 * a property of the session rather than of the tree, and two panes sharing one
 * client would be two operators who cannot help but agree. Each also builds its
 * own log, for the stronger version of the same reason: under this model the
 * two vantages hold different message SETS, and a shared log would be the
 * central store the design rejects.
 */
function paneTree(pane: Pane, index: number) {
  const fixture: StreamFixture = setupStreamFixture({
    carriedChannels: [
      "commandCentre.roster",
      "commandCentre.separation",
      "comms.delay",
      "comms.link",
    ],
    /*
     * The clock is deliberately left LIVE, not pinned to `VIEW_UT`. Pinning
     * looks like the way to make an arrival deterministic and does the opposite
     * here: the buffer releases by comparing each instant against
     * `utNowEstimate()` on the view clock's own frame callback, and a pinned
     * clock stopped every scene revealing anything at all. Measured, both ways.
     */
  });
  /*
   * Standing subscriptions, opened BEFORE anything is emitted.
   *
   * `StubTransport.emit` is subscription-gated and drops silently, and a widget
   * subscribes on mount, so emitting after a couple of frames is a race against
   * the mount rather than a wait for it. Losing it drops the separation matrix
   * for good, and a scene then renders with no correspondent to address.
   */
  for (const topic of [
    "commandCentre.roster",
    "commandCentre.separation",
    "comms.delay",
    "comms.link",
  ]) {
    fixture.subscribe(topic);
  }
  const identity = new StationIdentityService(memoryStorage(), pane.name);
  const log = pane.noLog
    ? null
    : new CommcastLog({
        screenKey: `probe-pane-${index}`,
        storage: memoryStorage(),
      });
  if (log) {
    log.setVantage(pane.vantage);
    log.replaceForTesting({
      outbox: (pane.sent ?? []).map((held) => {
        const msg = toMessage(held);
        const acks: CommsAck[] = (held.acks ?? []).map((a) => ({
          messageId: msg.id,
          from: a.from,
          stationKey: a.stationKey,
          seat: a.from.startsWith("vessel:") ? "pilot" : "mission-control",
          atUt: VIEW_UT + a.at,
        }));
        return { msg, acks, neverLeft: held.neverLeft === true };
      }),
      inbox: (pane.received ?? []).map(toMessage),
      pending: (pane.crossing ?? []).map(toMessage),
    });
  }
  /*
   * The radio, on a recorded clip. `webaudio.ts` is the only file in the radio
   * folder that touches a device or a codec, and a render harness can have
   * neither: no microphone to grant, and an `AudioContext` per pane per attempt
   * would run a page into its own limit. What is substituted is exactly those
   * two ends; the transmitter, the wire, the session and the control are all
   * the shipped ones.
   */
  const radio = clipRadio(SHORT_CLIP);
  // The SCREEN is what a provider carries; the seat is derived from it by `seatOf`, which is the whole reason a pane is declared by seat here: a peer-fed pilot would be a third screen at the same seat and this scene would not change.
  const widget = (
    <ScreenProvider value={pane.seat === "pilot" ? "pilot" : "main"}>
      <fixture.Provider>
        <StationIdentityProvider service={identity}>
          <RadioBackendProvider value={radio.backend}>
            <CommcastWidget id={`commcast-${index}`} config={{}} w={6} h={9} />
          </RadioBackendProvider>
        </StationIdentityProvider>
      </fixture.Provider>
    </ScreenProvider>
  );
  return {
    fixture,
    log,
    radio,
    node: (
      <div
        key={`${pane.seat}:${pane.vantage ?? ""}:${index}`}
        // The handle a click is scoped to, so driving one pane's inbox can
        // never reach the other vantage's widget.
        data-pane={index}
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "6px",
          flex: "1 1 0",
          minWidth: 0,
        }}
      >
        {/* Harness furniture, not the widget: which session this pane is, so
            a two-pane shot can be read. The widget itself never states its
            own vantage id. */}
        <div
          style={{
            font: "11px var(--font-family-mono, ui-monospace, monospace)",
            letterSpacing: "0.08em",
            color: "var(--color-text-faint, #6a6a6a)",
          }}
        >
          {`${pane.seat} · ${pane.vantage ?? "no vantage"}`}
        </div>
        <div style={{ display: "flex", flex: "1 1 auto", minHeight: 0 }}>
          {log ? (
            <CommcastLogProvider log={log}>{widget}</CommcastLogProvider>
          ) : (
            widget
          )}
        </div>
      </div>
    ),
  };
}

/**
 * One attempt at a scene: mounts it, feeds it, and waits for it to settle.
 * Returns whether it settled. `renderScene` below is what retries.
 */
async function renderSceneOnce(scene: Scene): Promise<boolean> {
  const mount = document.getElementById("root");
  if (!mount) throw new Error("#root missing");
  mount.style.width = `${scene.pxW}px`;
  mount.style.height = `${scene.pxH}px`;
  mount.style.overflow = "hidden";

  // BEFORE the mount, because the verdict is read once per mounted radio and
  // never re-read. Reset every time rather than only when a scene asks, so a
  // retry and the next scene both start from what the engine really offers.
  forceRadioSupport(scene.radioSupport);

  if (root) {
    root.unmount();
    root = undefined;
  }

  // The local participant's stationKey comes off `localStorage`; pin it so two
  // runs of one scene do not differ in ids that change nothing visible.
  localStorage.clear();
  localStorage.setItem("gonogo.station.key", "render-probe-local");

  const panes = scene.panes.map((p, i) => paneTree(p, i));
  lastLogCounts = panes.map((p) => {
    const snap = p.log?.snapshot();
    return {
      outbox: snap?.outbox.length ?? -1,
      inbox: snap?.inbox.length ?? -1,
      pending: snap?.pending.length ?? -1,
    };
  });

  root = createRoot(mount);
  root.render(
    <ThemeProvider theme={harnessTheme}>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "8px",
          width: "100%",
          height: "100%",
          padding: "8px",
          boxSizing: "border-box",
        }}
      >
        {scene.caption === undefined ? null : (
          <div
            style={{
              font: "11px var(--font-family-mono, ui-monospace, monospace)",
              letterSpacing: "0.06em",
              color: "var(--color-text-muted, #9a9a9a)",
            }}
          >
            {scene.caption}
          </div>
        )}
        <div
          style={{
            display: "flex",
            gap: "16px",
            flex: "1 1 auto",
            minHeight: 0,
          }}
        >
          {panes.map((p) => p.node)}
        </div>
      </div>
    </ThemeProvider>,
  );

  await twoFrames();

  // `StubTransport.emit` is subscription-gated, so nothing is published until
  // the widget has mounted and subscribed. `deliveredAt` is what anchors
  // `utNowEstimate()`, which every instant is compared against: without it the
  // estimate sits at 0, nothing ever arrives, and the composer reads "No clock
  // yet" for a reason unrelated to the scene. So a scene modelling a screen
  // with no craft still publishes an EMPTY separation, which anchors the clock
  // while leaving the path home absent.
  for (let i = 0; i < panes.length; i++) {
    const pane = scene.panes[i];
    const meta = {
      validAt: VIEW_UT,
      deliveredAt: VIEW_UT,
      ...(pane.vantage === undefined ? {} : { vantage: pane.vantage }),
    };
    if (scene.oneWaySeconds !== undefined) {
      panes[i].fixture.emit(
        "comms.delay",
        { oneWaySeconds: scene.oneWaySeconds },
        meta,
      );
    }
    if (scene.separation) {
      panes[i].fixture.emit(
        "commandCentre.separation",
        { pairs: scene.separation },
        meta,
      );
    }
    if (scene.roster) {
      panes[i].fixture.emit("commandCentre.roster", scene.roster, meta);
    }
    /*
     * `comms.link` is declared by the widget, so a scene that never publishes
     * it leaves a declared channel unfed. Default connected: the widget treats
     * silence as connected anyway, and publishing it makes that the recorded
     * state rather than the absent one.
     */
    panes[i].fixture.emit(
      "comms.link",
      { connected: scene.linkLost !== true },
      meta,
    );
  }

  /*
   * Two settles with the clicks between them, because the widget opens on the
   * inbox: a conversation is a couple of real interactions in, and the row that
   * leads to it does not exist until the feed has released what landed.
   *
   * The FIRST waits only for the clock, which every instant is compared
   * against, and it is checked by the absence of a dead composer rather than by
   * text. An inbox has no composer at all, so a pane that stays on the list
   * passes it on nothing, which is why the row's own appearance is what
   * `drivePane` waits for.
   */
  if (!(await settle(() => noDeadComposer()))) return false;
  for (let i = 0; i < scene.panes.length; i++) {
    if (!(await drivePane(scene.panes[i], i, panes[i].radio))) return false;
  }
  /*
   * The SECOND is the scene's own claim. The clock landing is not the arrival
   * happening: the buffer releases on a later frame, and a shot taken before it
   * photographs an empty log as though that were the scene's intent.
   */
  return await settle(() => noDeadComposer() && showsAll(scene.settleOn));
}

/** Whether every string the scene is waiting on is on screen. */
function showsAll(wanted: string | readonly string[] | undefined): boolean {
  if (wanted === undefined) return true;
  const text = mountedText();
  const all = typeof wanted === "string" ? [wanted] : wanted;
  return all.every((one) => text.includes(one));
}

/** Whether every composer on screen has a clock behind it. */
function noDeadComposer(): boolean {
  return (
    document.querySelectorAll('input[placeholder="No clock yet"]').length === 0
  );
}

/**
 * Renders one scene, remounting it if it does not settle.
 *
 * A scene loses the arrival race some fraction of the time: the log stays
 * empty and nothing releases. A remount is worth trying and is not reliable;
 * what actually moves the odds is the fresh document and the warm-up the caller
 * does before the first mount. The retries stay because they are cheap and they
 * do sometimes win.
 *
 * What it does NOT do is fall silent when every attempt loses. A render that
 * reaches a reviewer showing an unsettled log reads as a design claim, so the
 * last word is a warning naming the scene.
 */
async function renderScene(scene: Scene): Promise<void> {
  for (let attempt = 1; attempt <= 4; attempt++) {
    if (await renderSceneOnce(scene)) return;
    console.warn(
      `[retry ${attempt}] ${scene.name}: lost the arrival race, remounting`,
    );
  }
  /*
   * The mounted text goes with the warning. A scene that did not settle failed
   * for one of two reasons that look identical from outside, and the text tells
   * them apart at a glance: the widget rendered the wrong state, or it rendered
   * the right one and the predicate names something that is not on screen.
   */
  console.warn(
    `[did not settle] ${scene.name}: the scene never reached the state it was built to show after four mounts. This render is NOT the scene's intent. Waiting on ${JSON.stringify(scene.settleOn)}; logs held ${JSON.stringify(lastLogCounts)}; mounted text was ${JSON.stringify(
      mountedText().slice(0, 600),
    )}`,
  );
}

(
  window as unknown as { __renderCommcast: (s: Scene) => Promise<void> }
).__renderCommcast = renderScene;
