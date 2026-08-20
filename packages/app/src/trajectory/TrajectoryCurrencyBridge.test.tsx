import {
  createFakeWallClock,
  PropagationHorizonKindLike,
  StubTransport,
  TelemetryClient,
  TelemetryProvider,
  TimelineStore,
  TrajectoryKindLike,
  ViewClock,
} from "@ksp-gonogo/sitrep-client";
import { act, render, screen } from "@ksp-gonogo/test-utils";
import {
  PanelStatusStoreProvider,
  usePanelStatusStore,
} from "@ksp-gonogo/ui-kit";
import type { ReactNode } from "react";
import { useSyncExternalStore } from "react";
import { describe, expect, it } from "vitest";
import {
  TrajectoryCurrencyBridge,
  widgetReadsTrajectory,
} from "./TrajectoryCurrencyBridge";

/** The instant every test pins the view clock to. */
const VIEW_UT = 1_000;

/**
 * A real `TelemetryProvider` over a `StubTransport`, with the view clock pinned
 * so `useViewUt` answers `VIEW_UT`. Mirrors `scene-change-banner.test.tsx`:
 * `vessel.orbit` is a raw wire topic with no derived channel, so an emit plus a
 * synchronous `beginFrame()` is the whole setup.
 */
function setupOrbitStream() {
  const wall = createFakeWallClock();
  const transport = new StubTransport();
  const client = new TelemetryClient(transport);
  const clock = new ViewClock({
    nowWall: wall.now,
    warpRate: () => 1,
    delaySeconds: () => 0,
  });
  const store = new TimelineStore(clock);
  clock.scrubTo(VIEW_UT);

  function Provider({ children }: { children: ReactNode }) {
    return (
      <TelemetryProvider
        client={client}
        store={store}
        carriedChannels={["vessel.orbit"]}
      >
        {children}
      </TelemetryProvider>
    );
  }

  return {
    Provider,
    emitOrbit: (horizon: unknown) => {
      act(() => {
        transport.emit("vessel.orbit", {
          referenceBodyIndex: 0,
          sma: 8_000_000,
          ecc: 0.1,
          inc: 0,
          lan: 0,
          argPe: 0,
          meanAnomalyAtEpoch: 0,
          epoch: VIEW_UT,
          mu: 3.5316e12,
          horizon,
        });
        store.beginFrame();
      });
    },
  };
}

/**
 * Renders whatever contribution won the panel's summary, so a test asserts the
 * thing an operator would actually read rather than an internal call.
 */
function SummaryProbe() {
  const store = usePanelStatusStore();
  const summary = useSyncExternalStore(
    (onChange) => store?.subscribe(onChange) ?? (() => {}),
    () => store?.getSummary() ?? null,
  );
  return (
    <span data-testid="summary">
      {summary === null ? "NONE" : `${summary.severity}:${summary.label}`}
    </span>
  );
}

function mount(requirements: readonly string[]) {
  const stream = setupOrbitStream();
  render(
    <stream.Provider>
      <PanelStatusStoreProvider>
        <TrajectoryCurrencyBridge dataRequirements={requirements} />
        <SummaryProbe />
      </PanelStatusStoreProvider>
    </stream.Provider>,
  );
  return stream;
}

function summary(): string {
  return screen.getByTestId("summary").textContent ?? "";
}

const PAST = {
  kind: PropagationHorizonKindLike.Until,
  untilUt: VIEW_UT - 100,
  trajectoryKind: TrajectoryKindLike.Integrated,
};
const AHEAD = {
  kind: PropagationHorizonKindLike.Until,
  untilUt: VIEW_UT + 100,
  trajectoryKind: TrajectoryKindLike.Integrated,
};
const UNBOUNDED_ANALYTIC = {
  kind: PropagationHorizonKindLike.Unbounded,
  trajectoryKind: TrajectoryKindLike.Analytic,
};

describe("TrajectoryCurrencyBridge: the horizon, against the instant on screen", () => {
  /**
   * Both directions in one test on purpose. Asserting only the interesting
   * state would pass for a bridge that contributes that state unconditionally,
   * and asserting only the quiet state would pass for one that contributes
   * nothing at all. Requiring the summary to CHANGE, twice, is what rules both
   * out. Two `LandingStatus` tests in this repo passed vacuously in exactly the
   * first way.
   */
  it("moves from silence, to a refusal, to a shape note, as the horizon moves", () => {
    const stream = mount(["vessel.orbit"]);
    expect(summary()).toBe("NONE");

    stream.emitOrbit(PAST);
    expect(summary()).toBe("warning:BEYOND INTEGRATION");

    stream.emitOrbit(AHEAD);
    expect(summary()).toBe("info:EXACT AT SAMPLE");
  });

  it("says nothing for an unbounded analytic trajectory, which is the state today", () => {
    const stream = mount(["vessel.orbit"]);
    stream.emitOrbit(UNBOUNDED_ANALYTIC);
    expect(summary()).toBe("NONE");
  });

  /**
   * A producer that dropped the field is a distinct fact from one whose bound
   * has been outrun, and it must not read as health. `caution` rather than
   * `warning` because nothing has said the elements are wrong, only that
   * nothing has vouched for them.
   */
  it("separates an unstated horizon from an outrun one", () => {
    const stream = mount(["vessel.orbit"]);
    stream.emitOrbit(undefined);
    expect(summary()).toBe("caution:NO HORIZON STATED");
  });

  /**
   * The matching rule, driven through the real bridge rather than the predicate
   * alone: a widget that draws nothing from the trajectory stays silent through
   * the same emit that badges an orbit widget `warning` above.
   */
  it("stays silent on a widget that draws nothing from the trajectory", () => {
    const stream = mount(["vessel.comms"]);
    stream.emitOrbit(PAST);
    expect(summary()).toBe("NONE");
  });
});

describe("widgetReadsTrajectory: which declarations the horizon speaks about", () => {
  it("matches the payload and the fields beneath it, including legacy spellings", () => {
    expect(widgetReadsTrajectory(["vessel.orbit"])).toBe(true);
    expect(widgetReadsTrajectory(["vessel.orbit.ecc"])).toBe(true);
    expect(widgetReadsTrajectory(["o.sma"])).toBe(true);
    expect(widgetReadsTrajectory(["vessel.comms", "vessel.orbit"])).toBe(true);
  });

  it("does not match a sibling payload, or nothing at all", () => {
    expect(widgetReadsTrajectory(["vessel.comms"])).toBe(false);
    expect(widgetReadsTrajectory([])).toBe(false);
    expect(widgetReadsTrajectory(undefined)).toBe(false);
  });

  /**
   * Pins the KNOWN GAP rather than the behaviour anyone wants: `vessel.state`
   * derives from seven inputs and `vessel.orbit` is one of them, so walking up
   * would light a throttle readout on a trajectory problem. Documented on
   * `widgetReadsTrajectory` with what closing it needs (per-field provenance on
   * the derived channel). If that lands, this expectation flips, and it is
   * here so the flip is a deliberate edit rather than a silent widening.
   */
  it("does not walk up from a derived channel to its inputs", () => {
    expect(widgetReadsTrajectory(["vessel.state"])).toBe(false);
    expect(widgetReadsTrajectory(["vessel.state.apoapsisAlt"])).toBe(false);
  });
});
