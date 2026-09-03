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
}

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
  /** Text the scene is not settled until it renders. */
  settleOn?: string;
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
async function settle(
  predicate: (mounted: string) => boolean,
): Promise<boolean> {
  /*
   * The MOUNT's text, never the document's. The probe page carries the whole
   * bundle in an inline script, and a script element's text is part of
   * `document.body.textContent`, so a predicate looking for a widget's own copy
   * found it in the component's SOURCE and waited for a condition that could
   * never come true. Seven megabytes of body text against a few hundred bytes
   * of rendered widget is not a subtle margin.
   */
  const mounted = () => document.getElementById("root")?.textContent ?? "";
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
  // The SCREEN is what a provider carries; the seat is derived from it by `seatOf`, which is the whole reason a pane is declared by seat here: a peer-fed pilot would be a third screen at the same seat and this scene would not change.
  const widget = (
    <ScreenProvider value={pane.seat === "pilot" ? "pilot" : "main"}>
      <fixture.Provider>
        <StationIdentityProvider service={identity}>
          <CommcastWidget id={`commcast-${index}`} config={{}} w={6} h={9} />
        </StationIdentityProvider>
      </fixture.Provider>
    </ScreenProvider>
  );
  return {
    fixture,
    log,
    node: (
      <div
        key={`${pane.seat}:${pane.vantage ?? ""}:${index}`}
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
   * A live composer says the CLOCK has landed, which every instant is compared
   * against. A scene that also expects specific text names it, because the
   * clock landing is not the arrival happening: the buffer releases on a later
   * frame, and a shot taken before it photographs an empty log as though that
   * were the scene's intent.
   */
  return await settle(
    (mounted) =>
      document.querySelectorAll('input[placeholder="No clock yet"]').length ===
        0 &&
      (scene.settleOn === undefined || mounted.includes(scene.settleOn)),
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
      (document.getElementById("root")?.textContent ?? "").slice(0, 600),
    )}`,
  );
}

(
  window as unknown as { __renderCommcast: (s: Scene) => Promise<void> }
).__renderCommcast = renderScene;
