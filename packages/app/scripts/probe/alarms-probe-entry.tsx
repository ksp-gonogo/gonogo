import { ScreenProvider } from "@ksp-gonogo/core";
import {
  harnessTheme,
  type StreamFixture,
  setupStreamFixture,
} from "@ksp-gonogo/sitrep-sdk/testing";
import { setQuantityLocale } from "@ksp-gonogo/ui-kit";
import { createRoot, type Root } from "react-dom/client";
import { ThemeProvider } from "styled-components";
import { AlarmsModal } from "../../src/alarms/AlarmsModal";
import type { Alarm, AlarmSnapshot } from "../../src/alarms/types";

/**
 * Browser entry for the alarm-surface render harness. esbuild bundles it into
 * `alarms-probe.html`, and `scripts/render-alarms.ts` drives it through
 * `window.__renderAlarms`, screenshotting `#root`.
 *
 * The one thing worth looking at here is what the surface says under SIGNAL
 * DELAY, which is a question about pixels rather than about state: the same
 * modal with the same alarms renders a bare time on a LAN session and a
 * qualified one at four light-minutes, and the only way to judge whether that
 * qualifier reads as information or as noise is to see it.
 *
 * The modal is the real one over a real `TelemetryProvider`. Nothing is stubbed
 * at the component boundary.
 */

/* Pin the locale every quantity is written in. It defaults to the reader's,
   which is right for an operator and wrong for a render that has to look the
   same on every machine. */
setQuantityLocale("en-GB");

/** The view instant every scene is pinned to, so the dates are reproducible. */
const VIEW_UT = 1_000_000;

/**
 * Kerbin's GM and a parking orbit sitting exactly at periapsis at `VIEW_UT`, so
 * the derived `timeToAp` is half a period and the apoapsis preset has a
 * hand-checkable time. The same fixture `AlarmsModal.test.tsx` reasons about.
 */
const ORBIT = {
  referenceBodyIndex: 1,
  sma: 700_000,
  ecc: 0.01,
  inc: 0,
  lan: 0,
  argPe: 0,
  meanAnomalyAtEpoch: 0,
  epoch: VIEW_UT,
  mu: 3.5316e12,
};

/**
 * Every raw input `vessel.state` derives from, plus the two channels the time
 * context is read out of. Carried, not emitted: the gate is parent-channel
 * scoped, so `vessel.state.timeToAp` resolves only if all eight are allowed
 * through, whatever has actually arrived.
 */
const CARRIED = [
  "vessel.orbit",
  "vessel.flight",
  "vessel.identity",
  "system.bodies",
  "vessel.control",
  "vessel.target",
  "vessel.comms",
  "vessel.propulsion",
  "vessel.maneuver",
  "commandCentre.roster",
  "comms.delay",
];

/**
 * Two alarms that put both clocks in one list: a time alarm, whose UT is a
 * view-clock instant because that is when the operator will be told, and a
 * fired event alarm, whose `eventUT` is the occurrence's own SCET and so sits
 * one light-time before the moment it was revealed.
 */
function alarms(): Alarm[] {
  return [
    {
      id: "a1",
      name: "Circularise burn",
      trigger: { kind: "time", ut: VIEW_UT + 3600, leadSeconds: 10 },
      state: "pending",
      createdBy: "main",
      createdAt: 0,
    },
    {
      id: "a2",
      name: "Signal lost",
      trigger: { kind: "event", topic: "comms.events", eventKind: "los" },
      state: "fired",
      createdBy: "main",
      createdAt: 0,
      matchSinceUT: VIEW_UT,
      eventUT: VIEW_UT - 240,
    },
  ];
}

function snapshot(): AlarmSnapshot {
  return {
    alarms: alarms(),
    ut: VIEW_UT,
    warp: { index: 0, rate: 1, mode: "UNKNOWN" },
    unscheduledWarp: null,
    warpTo: null,
    warpSafetyMarginSeconds: 10,
  };
}

/** What one shot asks for. */
interface Scene {
  /** One-way light time in force, seconds. 0 is the LAN session. */
  delaySeconds: number;
  pxW: number;
  pxH: number;
}

let root: Root | undefined;

async function renderScene(scene: Scene): Promise<void> {
  const host = document.getElementById("root");
  if (!host) throw new Error("#root missing");
  host.style.width = `${scene.pxW}px`;
  host.style.height = `${scene.pxH}px`;
  host.style.overflow = "hidden";

  if (root) {
    root.unmount();
    root = undefined;
  }

  const fixture: StreamFixture = setupStreamFixture({
    carriedChannels: CARRIED,
    pinnedUt: VIEW_UT,
    delaySeconds: scene.delaySeconds,
  });
  /*
   * Hold a standing subscription on every topic before anything mounts. A
   * `StubTransport` emit is subscription-gated, so waiting for the modal's own
   * subscriptions makes the payload land or not depending on how long React
   * takes to commit: the FIRST scene rendered on a cold page lost its orbit
   * this way and drew no presets at all, while the second drew them, and the
   * two scenes then differed by something other than the one variable they are
   * supposed to differ by.
   */
  for (const topic of CARRIED) fixture.subscribe(topic);

  root = createRoot(host);
  root.render(
    <ThemeProvider theme={harnessTheme}>
      <ScreenProvider value="main">
        <fixture.Provider>
          <AlarmsModal
            useSnapshot={snapshot}
            onAdd={() => {}}
            onUpdate={() => {}}
            onDelete={() => {}}
          />
        </fixture.Provider>
      </ScreenProvider>
    </ThemeProvider>,
  );

  // Two frames is what it takes for React to commit and for the effects to run.
  await new Promise((r) =>
    requestAnimationFrame(() => requestAnimationFrame(r)),
  );
  /* The vantage stamp rides the frame meta, which is how the client learns
     which centre its data is delayed from; the roster is what turns that id
     into a name an operator reads. */
  fixture.emit("commandCentre.roster", [
    { id: "ksc", displayName: "KSC", kind: 0, active: true },
  ]);
  /*
   * The orbit, three times, each with its own minted frame and a paint between.
   * The provider's ingest tick is what normally mints those, and whether it had
   * run by screenshot time was a coin toss: the same scene drew its apsis
   * preset on one run and not the next, so the pair differed by luck instead of
   * by light-time. Repeating the emit rather than only the frame is what makes
   * it hold for a consumer subscribed either way round, which is how the
   * BEFORE half of a comparison render gets the same treatment as the after.
   */
  for (let i = 0; i < 3; i++) {
    fixture.emit("vessel.orbit", ORBIT, { vantage: "ksc" });
    fixture.store.beginFrame();
    await new Promise((r) =>
      requestAnimationFrame(() => requestAnimationFrame(r)),
    );
  }
}

(
  window as unknown as { __renderAlarms: (s: Scene) => Promise<void> }
).__renderAlarms = renderScene;
