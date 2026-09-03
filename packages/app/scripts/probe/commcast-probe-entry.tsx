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
import { CommcastHostProvider } from "../../src/commcast/CommcastHostContext";
import { CommcastHostService } from "../../src/commcast/CommcastHostService";
import type { CommsParticipant } from "../../src/commcast/types";
import {
  StationIdentityProvider,
  StationIdentityService,
} from "../../src/stationIdentity";

/**
 * Browser entry for the Commcast render harness. esbuild bundles it into
 * `commcast-probe.html`, and `scripts/render-commcast.ts` drives it through
 * `window.__renderCommcast`, screenshotting `#root`.
 *
 * Two panes over ONE thread is the whole reason this exists. Commcast's
 * subject is that two seats see different threads at the same instant, and a
 * single-pane shot of either one is indistinguishable from a widget with no
 * delay in it at all. So a scene mounts the same `CommcastHostService` behind
 * two independent `TelemetryProvider`s, each with its own observed vantage,
 * and the two panes disagree on screen the way the two operators would.
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

/** One seat's view of the thread. */
export interface Pane {
  /** Drives `useSeat()`, and therefore which end of the light-path this is. */
  seat: "mission-control" | "pilot";
  /** The centre this session's frames were delayed from (`useObservedVantage`). */
  vantage?: string;
  /** What this screen posts (and is captioned) as. */
  name: string;
}

/** One message already in the thread when the panes mount. */
export interface Posted {
  author: CommsParticipant;
  body: string;
  /** Relative to `VIEW_UT`; negative is in the past. */
  sentAt: number;
  /** The author's own path home at send. `null` is NO PATH, never a zero. */
  oneWaySeconds: number | null;
}

export interface Scene {
  panes: Pane[];
  messages?: Posted[];
  /** Published vantage-to-vantage separations, one-way seconds. */
  separation?: { from: string; to: string; oneWaySeconds: number }[];
  /** `comms.delay`'s own path home, or omitted for a screen with no craft. */
  oneWaySeconds?: number;
  /**
   * Mount without a host service and without a peer, so the widget has no
   * route to a thread at all. The other end of the empty state.
   */
  noThread?: boolean;
  /** For the settle report, so an unsettled render names itself. */
  name: string;
  /**
   * Publish `comms.link` as CONFIRMED disconnected, so the thread terminates
   * with its no-signal marker. Distinct from an in-transit message: it says
   * there may be words this seat has not heard, not that one specific
   * utterance is on its way.
   */
  linkLost?: boolean;
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

function twoFrames(): Promise<void> {
  return new Promise((r) =>
    requestAnimationFrame(() => requestAnimationFrame(() => r())),
  );
}

/**
 * Waits for a scene to actually settle, rather than for a fixed number of
 * frames to have gone by.
 *
 * Two frames was a race and lost: the reveal runs off the view clock's own
 * frame callback, and how many frames it takes depends on how many
 * subscriptions the widget opened and when each was acked, which moves when
 * the widget declares one more channel. Losing it renders a scene whose thread
 * is entirely "in transit" and whose composer reads "No clock yet", which
 * photographs as a design claim rather than as a harness that ran early.
 *
 * `predicate` is what the scene is waiting to be true of the DOM. Frames, not
 * timers, so it stays on the same clock the reveal is on.
 */
async function settle(
  predicate: (mounted: string) => boolean,
): Promise<boolean> {
  /*
   * The MOUNT's text, never the document's. The probe page carries the whole
   * bundle in an inline script, and a script element's text is part of
   * `document.body.textContent`, so a predicate looking for a widget's own
   * copy for "still crossing" found it in the component's SOURCE and waited
   * for a condition that could never come true. Seven megabytes of body text
   * against a few hundred bytes of rendered widget is not a subtle margin, and
   * it read as a scene that would not settle.
   */
  const mounted = () => document.getElementById("root")?.textContent ?? "";
  // Short, because a scene that settles settles in well under a second and one
  // that lost the race does not recover on its own: what recovers it is a fresh
  // mount, which is `renderScene`'s job. A long wait here only makes four
  // attempts slow.
  const deadline = Date.now() + 3_000;
  // Waits BEFORE the first check, so a scene with nothing to wait for (no
  // composer at all) still gets a paint rather than being captured on the
  // frame its predicate happened to be vacuously true on.
  //
  // A frame pair AND a macrotask, because rAF alone is not enough and that is
  // what made a frame-count settle look adequate. Headless Chromium serves a
  // tight rAF loop almost synchronously, so several hundred callbacks can run
  // through before React flushes the effects that push into the reveal buffer
  // at all: the loop then exhausts itself against a tree that was never given
  // a turn to advance. The timeout yields to the macrotask queue those effects
  // and the transport's own delivery run on.
  while (Date.now() < deadline) {
    await twoFrames();
    await new Promise((r) => setTimeout(r, 16));
    if (predicate(mounted())) {
      // One more pair, so the frame that satisfied the predicate has also been
      // painted with everything else it released alongside.
      await twoFrames();
      return true;
    }
  }
  return false;
}

/**
 * One pane: a real widget over its own stream session.
 *
 * Each pane builds its own `TelemetryClient`, because the observed vantage is
 * a property of the session rather than of the tree, and two panes sharing one
 * client would be two operators who cannot help but agree.
 */
function paneTree(pane: Pane, host: CommcastHostService | null) {
  const fixture: StreamFixture = setupStreamFixture({
    carriedChannels: ["comms.delay", "commandCentre.separation", "comms.link"],
    /*
     * The clock is deliberately left LIVE, not pinned to `VIEW_UT`. Pinning
     * looks like the way to make a reveal deterministic and does the opposite
     * here: the buffer releases by comparing each message's instant against
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
   * for good, and a scene then renders every message as still crossing with no
   * countdown to print, which photographs as a design claim. It was lost about
   * half the time, on whichever scenes the roll went against, which is what
   * made it read as one scene being broken.
   */
  for (const topic of [
    "comms.delay",
    "commandCentre.separation",
    "comms.link",
  ]) {
    fixture.subscribe(topic);
  }
  const identity = new StationIdentityService(memoryStorage(), pane.name);
  // The SCREEN is what a provider carries; the seat is derived from it by `seatOf`, which is the whole reason a pane is declared by seat here: a peer-fed pilot would be a third screen at the same seat and this scene would not change.
  const widget = (
    <ScreenProvider value={pane.seat === "pilot" ? "pilot" : "main"}>
      <fixture.Provider>
        <StationIdentityProvider service={identity}>
          <CommcastWidget
            id={`commcast-${pane.seat}`}
            config={{}}
            w={6}
            h={9}
          />
        </StationIdentityProvider>
      </fixture.Provider>
    </ScreenProvider>
  );
  return {
    fixture,
    node: (
      <div
        key={`${pane.seat}:${pane.vantage ?? ""}`}
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
          {host ? (
            <CommcastHostProvider service={host}>{widget}</CommcastHostProvider>
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

  if (root) {
    root.unmount();
    root = undefined;
  }

  // The local participant's stationKey comes off `localStorage` and is shared by both panes, so pin it: a fresh uuid per scene changes nothing visible but makes the two runs of one scene differ in the thread's own ids.
  localStorage.clear();
  localStorage.setItem("gonogo.station.key", "render-probe-local");

  const host = scene.noThread
    ? null
    : // `load` rather than a storage stub: the constructor falls back to the real `localStorage` for persistence either way, and what a scene must not do is READ the previous scene's thread back.
      new CommcastHostService({ now: () => 0, load: () => [] });

  for (const m of scene.messages ?? []) {
    host?.post(m.author, {
      kind: "text",
      body: m.body,
      sentUt: VIEW_UT + m.sentAt,
      oneWaySeconds: m.oneWaySeconds,
      ...(m.author.vantageId === undefined
        ? {}
        : { authorVantageId: m.author.vantageId }),
    });
  }

  const panes = scene.panes.map((p) => paneTree(p, host));

  root = createRoot(mount);
  root.render(
    <ThemeProvider theme={harnessTheme}>
      <div
        style={{
          display: "flex",
          gap: "16px",
          width: "100%",
          height: "100%",
          padding: "8px",
          boxSizing: "border-box",
        }}
      >
        {panes.map((p) => p.node)}
      </div>
    </ThemeProvider>,
  );

  await twoFrames();

  // `StubTransport.emit` is subscription-gated, so nothing is published until
  // the widget has mounted and subscribed. `deliveredAt` is what anchors
  // `utNowEstimate()`, which is the clock every reveal instant is compared
  // against: without it the estimate sits at 0, nothing is ever revealed, and
  // the composer reads "No clock yet" for a reason unrelated to the scene. So
  // a scene modelling a screen with no craft still publishes an EMPTY
  // separation, which anchors the clock while leaving the path home absent.
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
    /*
     * `comms.link` is declared by the widget, so a scene that never publishes
     * it leaves a declared channel unfed. Default connected: the widget treats
     * silence as connected anyway, and publishing it makes that the recorded
     * state rather than the absent one. `linkLost` is the scene that says the
     * link is confirmed gone, which is what terminates the thread.
     */
    panes[i].fixture.emit(
      "comms.link",
      { connected: scene.linkLost !== true },
      meta,
    );
  }

  /*
   * Two signatures of a scene that has not settled, and both are needed. A
   * live composer says the CLOCK has landed, which is what every reveal
   * instant is compared against. But the clock landing is not the reveal
   * happening: the buffer releases on a later frame, and until the separation
   * matrix has arrived with it every crossing message reads "lands when the
   * clock is known", which is a message whose delivery has no computable
   * instant. In a settled scene that is unreachable: a message with no path is
   * filed as unreachable and says so in its own words, so an in-transit row
   * always has a countdown. Waiting on the clock alone photographed a whole
   * thread as still crossing.
   */
  return await settle(
    (mounted) =>
      document.querySelectorAll('input[placeholder="No clock yet"]').length ===
        0 && !mounted.includes("lands when the clock is known"),
  );
}

/**
 * Renders one scene, remounting it if it does not settle.
 *
 * A scene loses the reveal race some fraction of the time: the thread stays
 * empty, every message sits in the transit strip with no countdown to print,
 * and the widget's own `deliveryFor` disagrees with its feed about them. That
 * is a real defect and it wants a failing unit test on the feed rather than a
 * harness workaround.
 *
 * A remount is worth trying and is not reliable: a scene that has lost it often
 * loses all four, and what actually moves the odds is the fresh document and
 * the warm-up the caller does before the first mount. The retries stay because
 * they are cheap and they do sometimes win.
 *
 * What it does NOT do is fall silent when every attempt loses. A render that
 * reaches a reviewer showing an unsettled thread reads as a design claim, so
 * the last word is a warning naming the scene.
 */
async function renderScene(scene: Scene): Promise<void> {
  for (let attempt = 1; attempt <= 4; attempt++) {
    if (await renderSceneOnce(scene)) return;
    console.warn(
      `[retry ${attempt}] ${scene.name}: lost the reveal race, remounting`,
    );
  }
  console.warn(
    `[did not settle] ${scene.name}: every message is still shown as crossing after four mounts. This render shows an UNSETTLED thread, NOT the scene's intent.`,
  );
}

(
  window as unknown as { __renderCommcast: (s: Scene) => Promise<void> }
).__renderCommcast = renderScene;
