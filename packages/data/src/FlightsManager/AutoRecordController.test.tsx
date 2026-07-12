import { clearRegistry, registerDataSource } from "@ksp-gonogo/core";
import {
  StubTransport,
  TelemetryClient,
  TelemetryProvider,
  TimelineStore,
  ViewClock,
} from "@ksp-gonogo/sitrep-client";
import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MissionStore } from "../storage/MissionStore";
import { AutoRecordController } from "./AutoRecordController";
import {
  getAutoRecordStatus,
  resetAutoRecordStatusForTests,
} from "./autoRecordStatus";
import { MissionHistorySource } from "./MissionHistorySource";

/**
 * Coverage for the auto-record lifecycle — post flight-lifecycle spec
 * (`docs/superpowers/plans/2026-07-11-flight-lifecycle-spec.md`), boundaries
 * are delimited by the mod's own `flight.started`/`flight.ended` events
 * rather than the retired client-side `FlightDetector` heuristic. This
 * suite drives those events directly through `StubTransport`.
 */

/** Same fake-rAF double `context.test.tsx` uses to make `scheduleFrame` deterministic under jsdom (no real rAF). */
function installFakeRaf() {
  let nextHandle = 1;
  const pending = new Map<number, () => void>();
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback): number => {
    const handle = nextHandle++;
    pending.set(handle, () => cb(0));
    return handle;
  });
  vi.stubGlobal("cancelAnimationFrame", (handle: number): void => {
    pending.delete(handle);
  });
  return {
    flush(): void {
      const callbacks = [...pending.values()];
      pending.clear();
      for (const cb of callbacks) cb();
    },
  };
}

interface Rig {
  transport: StubTransport;
  client: TelemetryClient;
  clock: ViewClock;
  store: TimelineStore;
  missionStore: MissionStore;
  source: MissionHistorySource;
  raf: ReturnType<typeof installFakeRaf>;
}

let dbCounter = 0;

function buildRig(): Rig {
  const raf = installFakeRaf();
  const transport = new StubTransport();
  const client = new TelemetryClient(transport);
  const clock = new ViewClock();
  const store = new TimelineStore(clock);

  dbCounter += 1;
  const missionStore = new MissionStore({
    dbName: `auto-record-test-${dbCounter}`,
  });
  const source = new MissionHistorySource(missionStore);
  registerDataSource(source);

  // StreamRecorder is subscription-scoped by default (recordAllTopics:
  // false, AutoRecordController's own default) -- it only captures frames
  // for topics something ELSE has subscribed to. In production that's
  // whatever widget the operator has mounted (a vessel readout, etc.); here
  // we simulate that directly so the frame-count assertions below have
  // something to count, mirroring a real dashboard with a vessel.identity
  // widget open.
  client.subscribe("vessel.identity", () => {});

  return { transport, client, clock, store, missionStore, source, raf };
}

/** Emits a `flight.started` event, pins the shared clock's viewUt to `ut`, and flushes the coalesced beginFrame — one full "tick" of the stream. */
function start(
  rig: Rig,
  ut: number,
  flight: { flightId: string; vesselId: string; vesselName: string },
): void {
  act(() => {
    rig.transport.emit(
      "flight.started",
      { ...flight, ut },
      { validAt: ut, deliveredAt: ut },
    );
    rig.clock.scrubTo(ut);
    rig.raf.flush();
  });
}

/** Emits a `flight.ended` event for `flightId`. */
function end(rig: Rig, ut: number, flightId: string, reason = 0): void {
  act(() => {
    rig.transport.emit(
      "flight.ended",
      { flightId, vesselId: flightId, vesselName: "", reason, ut },
      { validAt: ut, deliveredAt: ut },
    );
    rig.clock.scrubTo(ut);
    rig.raf.flush();
  });
}

/**
 * Emits a `vessel.identity` sample (feeds `StreamRecorder`'s own frame
 * capture) alongside a `flight.current` tick (the live frame-count
 * heartbeat `AutoRecordController` reads — see its own doc comment),
 * mirroring how the mod publishes both every sample while a flight is
 * active. Flushes one coalesced frame.
 */
function tickFrame(rig: Rig, ut: number, vesselId: string, name: string): void {
  act(() => {
    rig.transport.emit(
      "vessel.identity",
      { vesselId, name, launchUt: 0 },
      { validAt: ut, deliveredAt: ut },
    );
    rig.transport.emit(
      "flight.current",
      { flightId: vesselId, vesselId, vesselName: name, phase: 0 },
      { validAt: ut, deliveredAt: ut },
    );
    rig.clock.scrubTo(ut);
    rig.raf.flush();
  });
}

beforeEach(() => {
  clearRegistry();
  resetAutoRecordStatusForTests();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("AutoRecordController", () => {
  it("mounts without throwing when no TelemetryProvider is in the tree", () => {
    // The real-world case this guards: SitrepTelemetryProvider only mounts
    // a TelemetryProvider once the dev streaming flag is on AND its client
    // has connected — release builds (and the pre-connect window in dev)
    // render `children` bare. AutoRecordController is mounted
    // unconditionally at MainScreen, so it must degrade to idle rather than
    // throw.
    expect(() =>
      render(<AutoRecordController missionHistoryEnabled />),
    ).not.toThrow();
    expect(getAutoRecordStatus().recording).toBe(false);
  });

  it("starts recording the moment flight.started fires", () => {
    const rig = buildRig();
    render(
      <TelemetryProvider client={rig.client} store={rig.store}>
        <AutoRecordController missionHistoryEnabled />
      </TelemetryProvider>,
    );

    expect(getAutoRecordStatus().recording).toBe(false);

    start(rig, 0, { flightId: "vA", vesselId: "vA", vesselName: "Alpha" });

    expect(getAutoRecordStatus().recording).toBe(true);
    expect(getAutoRecordStatus().vesselName).toBe("Alpha");
  });

  it("saves the finished flight through MissionHistorySource when flight.ended fires for the SAME flight id", async () => {
    const rig = buildRig();
    render(
      <TelemetryProvider client={rig.client} store={rig.store}>
        <AutoRecordController missionHistoryEnabled />
      </TelemetryProvider>,
    );

    start(rig, 0, { flightId: "vA", vesselId: "vA", vesselName: "Alpha" });
    tickFrame(rig, 5, "vA", "Alpha");
    tickFrame(rig, 10, "vA", "Alpha");
    expect(getAutoRecordStatus().recording).toBe(true);
    expect(getAutoRecordStatus().frameCount).toBeGreaterThanOrEqual(2);

    end(rig, 10, "vA");

    const flights = await rig.source.listFlights();
    expect(flights).toHaveLength(1);
    expect(flights[0]?.vesselName).toBe("Alpha");
    expect(flights[0]?.sampleCount).toBeGreaterThanOrEqual(2);

    // The recording is closed -- no session left open.
    expect(getAutoRecordStatus().recording).toBe(false);
  });

  it("a flight.ended for a DIFFERENT flight id is ignored (never closes the wrong session)", () => {
    const rig = buildRig();
    render(
      <TelemetryProvider client={rig.client} store={rig.store}>
        <AutoRecordController missionHistoryEnabled />
      </TelemetryProvider>,
    );

    start(rig, 0, { flightId: "vA", vesselId: "vA", vesselName: "Alpha" });
    end(rig, 5, "vSomeOtherVessel");

    expect(getAutoRecordStatus().recording).toBe(true);
  });

  it("flight.started closes whatever session is open and starts a fresh one for the new flight", async () => {
    const rig = buildRig();
    render(
      <TelemetryProvider client={rig.client} store={rig.store}>
        <AutoRecordController missionHistoryEnabled />
      </TelemetryProvider>,
    );

    start(rig, 0, { flightId: "vA", vesselId: "vA", vesselName: "Alpha" });
    tickFrame(rig, 5, "vA", "Alpha");
    tickFrame(rig, 10, "vA", "Alpha");

    // A different vessel starts -- e.g. the mod republished flight.started
    // without the operator ever seeing flight.ended for Alpha (an edge case
    // this controller must still not lose data on).
    start(rig, 10, { flightId: "vB", vesselId: "vB", vesselName: "Bravo" });

    const flights = await rig.source.listFlights();
    expect(flights).toHaveLength(1);
    expect(flights[0]?.vesselName).toBe("Alpha");

    expect(getAutoRecordStatus().recording).toBe(true);
    expect(getAutoRecordStatus().vesselName).toBe("Bravo");
  });

  it("records nothing while the master switch is off", async () => {
    const rig = buildRig();
    render(
      <TelemetryProvider client={rig.client} store={rig.store}>
        <AutoRecordController missionHistoryEnabled={false} />
      </TelemetryProvider>,
    );

    start(rig, 0, { flightId: "vA", vesselId: "vA", vesselName: "Alpha" });
    tickFrame(rig, 5, "vA", "Alpha");
    end(rig, 5, "vA");

    expect(getAutoRecordStatus().recording).toBe(false);
    expect(getAutoRecordStatus().frameCount).toBe(0);
    expect(await rig.source.listFlights()).toEqual([]);
  });

  it("resumes recording the already-tracked flight when the master switch flips back on mid-flight", () => {
    const rig = buildRig();
    const { rerender } = render(
      <TelemetryProvider client={rig.client} store={rig.store}>
        <AutoRecordController missionHistoryEnabled={false} />
      </TelemetryProvider>,
    );

    // flight.started still fires (and is tracked) even while disabled --
    // only the actual recorder.start() is gated.
    start(rig, 0, { flightId: "vA", vesselId: "vA", vesselName: "Alpha" });
    expect(getAutoRecordStatus().recording).toBe(false);

    act(() => {
      rerender(
        <TelemetryProvider client={rig.client} store={rig.store}>
          <AutoRecordController missionHistoryEnabled />
        </TelemetryProvider>,
      );
    });

    expect(getAutoRecordStatus().recording).toBe(true);
    expect(getAutoRecordStatus().vesselName).toBe("Alpha");
  });

  it("treats a revert (the mod republishes flight.ended{reverted} then flight.started) as a fresh mission", async () => {
    const rig = buildRig();
    const { rerender } = render(
      <TelemetryProvider client={rig.client} store={rig.store}>
        <AutoRecordController missionHistoryEnabled />
      </TelemetryProvider>,
    );

    start(rig, 0, { flightId: "vA", vesselId: "vA", vesselName: "Alpha" });
    tickFrame(rig, 10, "vA", "Alpha");
    tickFrame(rig, 20, "vA", "Alpha");
    const preRevertFrameCount = getAutoRecordStatus().frameCount;
    expect(preRevertFrameCount).toBeGreaterThanOrEqual(2);

    // Revert to launch: FlightLifecycleSampler publishes flight.ended
    // {reverted} for the old flight, then flight.started for the new one --
    // both delivered here as the operator's OWN delayed view, at whatever
    // Ut the mod stamped them (a revert-target Ut, which can be BEHIND the
    // pre-revert highwater mark from the client's clock perspective too).
    end(rig, 2, "vA", 2 /* Reverted */);
    start(rig, 2, { flightId: "vA", vesselId: "vA", vesselName: "Alpha" });

    const flights = await rig.source.listFlights();
    expect(flights).toHaveLength(1);
    expect(flights[0]?.vesselName).toBe("Alpha");
    expect(flights[0]?.sampleCount).toBeGreaterThanOrEqual(preRevertFrameCount);

    // The post-revert session is fresh -- still recording, but restarted.
    expect(getAutoRecordStatus().recording).toBe(true);
    expect(getAutoRecordStatus().frameCount).toBeLessThan(preRevertFrameCount);

    // A further tick on the post-revert flight, then ending it (master off,
    // same component instance) proves the revert really did open a SECOND,
    // independent mission.
    tickFrame(rig, 5, "vA", "Alpha");
    act(() => {
      rerender(
        <TelemetryProvider client={rig.client} store={rig.store}>
          <AutoRecordController missionHistoryEnabled={false} />
        </TelemetryProvider>,
      );
    });

    const finalFlights = await rig.source.listFlights();
    expect(finalFlights).toHaveLength(2);
  });
});
