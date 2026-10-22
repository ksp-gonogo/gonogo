import { clearRegistry, registerDataSource } from "@ksp-gonogo/core";
import {
  TelemetryClient,
  TelemetryProvider,
  TimelineStore,
  ViewClock,
} from "@ksp-gonogo/sitrep-client";
import { StubTransport } from "@ksp-gonogo/sitrep-sdk/testing";
import { act, render } from "@ksp-gonogo/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MissionStore } from "../storage/MissionStore";
import { AutoRecordController } from "./AutoRecordController";
import {
  getAutoRecordStatus,
  resetAutoRecordStatusForTests,
} from "./autoRecordStatus";
import { MissionHistorySource } from "./MissionHistorySource";

/**
 * Coverage for the auto-record lifecycle: post flight-lifecycle spec,
 * boundaries
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

/** Emits a `flight.started` event, pins the shared clock's viewUt to `ut`, and flushes the coalesced beginFrame, one full "tick" of the stream. */
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
 * heartbeat `AutoRecordController` reads; see its own doc comment),
 * mirroring how the mod publishes both every sample while a flight is
 * active. Flushes one coalesced frame.
 */
function tickFrame(
  rig: Rig,
  ut: number,
  vesselId: string,
  name: string,
  flightId = vesselId,
): void {
  act(() => {
    rig.transport.emit(
      "vessel.identity",
      { vesselId, name, launchUt: 0 },
      { validAt: ut, deliveredAt: ut },
    );
    rig.transport.emit(
      "flight.current",
      { flightId, vesselId, vesselName: name, phase: 0 },
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
  it("adds no row when a page load at the Space Center is sent the retained events of a closed flight", async () => {
    const rig = buildRig();
    const tree = (scene: "Flight" | "SpaceCenter") => (
      <TelemetryProvider client={rig.client} store={rig.store}>
        <AutoRecordController missionHistoryEnabled scene={scene} />
      </TelemetryProvider>
    );
    const { rerender } = render(tree("Flight"));
    start(rig, 0, { flightId: "vA", vesselId: "vA", vesselName: "Alpha" });
    tickFrame(rig, 5, "vA", "Alpha");
    end(rig, 6, "vA", 0);
    act(() => rerender(tree("SpaceCenter")));
    expect(await rig.source.listFlights()).toHaveLength(1);

    /* The retained started, ended and current of the closed flight, in the order the mod sends them on every subscribe. */
    const replay = (ut: number): void => {
      act(() => {
        const meta = { validAt: 0, deliveredAt: ut };
        rig.transport.emit(
          "flight.started",
          { flightId: "vA", vesselId: "vA", vesselName: "Alpha", ut: 0 },
          meta,
        );
        rig.transport.emit(
          "flight.ended",
          {
            flightId: "vA",
            vesselId: "vA",
            vesselName: "Alpha",
            reason: 0,
            ut: 6,
          },
          meta,
        );
        rig.transport.emit(
          "flight.current",
          { flightId: "vA", vesselId: "vA", vesselName: "Alpha", phase: 0 },
          meta,
        );
        rig.clock.scrubTo(ut);
        rig.raf.flush();
      });
    };
    replay(100);
    replay(200);

    expect(getAutoRecordStatus().recording).toBe(false);
    expect(await rig.source.listFlights()).toHaveLength(1);
  });

  describe("at the Space Center, where no vessel is active", () => {
    /** What the stream says when the page opens, or a flight is recovered, with the game at the Space Center. */
    function spaceCenterFrames(rig: Rig, ut: number): void {
      act(() => {
        rig.transport.emit("flight.current", null, {
          validAt: ut,
          deliveredAt: ut,
        });
        rig.transport.emit("flight.started", null, {
          validAt: ut,
          deliveredAt: ut,
        });
        rig.transport.emit("flight.ended", null, {
          validAt: ut,
          deliveredAt: ut,
        });
        rig.transport.emit("flight.vesselChanged", null, {
          validAt: ut,
          deliveredAt: ut,
        });
        rig.clock.scrubTo(ut);
        rig.raf.flush();
      });
    }

    it("records no flight and throws nothing when every flight topic reads absent", async () => {
      const rig = buildRig();
      render(
        <TelemetryProvider client={rig.client} store={rig.store}>
          <AutoRecordController missionHistoryEnabled scene="SpaceCenter" />
        </TelemetryProvider>,
      );

      // The client catches a throwing subscriber and reports it here.
      const reported = vi.spyOn(console, "error").mockImplementation(() => {});
      spaceCenterFrames(rig, 10);
      spaceCenterFrames(rig, 20);

      expect(reported).not.toHaveBeenCalled();
      reported.mockRestore();

      expect(getAutoRecordStatus().recording).toBe(false);
      expect(await rig.source.listFlights()).toHaveLength(0);
    });

    it("keeps the flight a recovery ended as the only row", async () => {
      const rig = buildRig();
      const tree = (scene: "Flight" | "SpaceCenter") => (
        <TelemetryProvider client={rig.client} store={rig.store}>
          <AutoRecordController missionHistoryEnabled scene={scene} />
        </TelemetryProvider>
      );
      const { rerender } = render(tree("Flight"));
      start(rig, 0, { flightId: "vA", vesselId: "vA", vesselName: "Alpha" });
      tickFrame(rig, 5, "vA", "Alpha");
      end(rig, 6, "vA", 0);
      act(() => rerender(tree("SpaceCenter")));

      const reported = vi.spyOn(console, "error").mockImplementation(() => {});
      spaceCenterFrames(rig, 30);

      expect(reported).not.toHaveBeenCalled();
      reported.mockRestore();
      expect(await rig.source.listFlights()).toHaveLength(1);
    });
  });

  it("mounts without throwing when no TelemetryProvider is in the tree", () => {
    // The real-world case this guards: SitrepTelemetryProvider only mounts
    // a TelemetryProvider once the dev streaming flag is on AND its client
    // has connected, release builds (and the pre-connect window in dev)
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

  it("puts the reason a flight ended on its mission when focus had already moved to another vessel", async () => {
    const rig = buildRig();
    render(
      <TelemetryProvider client={rig.client} store={rig.store}>
        <AutoRecordController missionHistoryEnabled />
      </TelemetryProvider>,
    );

    start(rig, 0, { flightId: "vA", vesselId: "vA", vesselName: "Alpha" });
    tickFrame(rig, 5, "vA", "Alpha");
    start(rig, 10, { flightId: "vB", vesselId: "vB", vesselName: "Bravo" });
    tickFrame(rig, 15, "vB", "Bravo");

    end(rig, 20, "vA", 0 /* Recovered */);

    await vi.waitFor(async () => {
      const alpha = (await rig.source.listFlights()).find(
        (f) => f.vesselName === "Alpha",
      );
      expect(alpha?.endReason).toBe(0);
    });
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

  it("arms mid-flight on the host's re-announce, the dashboard opened after the launch", async () => {
    // The ordinary case: KSP is already flying when the browser connects, so
    // the launch publish was dropped and the host re-announces the open
    // flight to this subscriber (FlightLifecycleSampler). Without it,
    // auto-record never arms for the rest of that flight.
    const rig = buildRig();
    render(
      <TelemetryProvider client={rig.client} store={rig.store}>
        <AutoRecordController missionHistoryEnabled />
      </TelemetryProvider>,
    );

    // ut 0 is the launch instant; the dashboard is only here now.
    start(rig, 0, { flightId: "vA", vesselId: "vA", vesselName: "Alpha" });

    expect(getAutoRecordStatus().recording).toBe(true);
    expect(getAutoRecordStatus().vesselName).toBe("Alpha");
    expect(await rig.source.listFlights()).toEqual([]);
  });

  it("closes the recording at the main menu, so the next game's flight is a row of its own", async () => {
    const rig = buildRig();
    render(
      <TelemetryProvider client={rig.client} store={rig.store}>
        <AutoRecordController missionHistoryEnabled scene="Flight" />
      </TelemetryProvider>,
    );

    start(rig, 0, { flightId: "gA", vesselId: "vA", vesselName: "Alpha" });
    tickFrame(rig, 5, "vA", "Alpha", "gA");
    // The scene reading is held at Flight while the game sits at its main menu.
    act(() => {
      rig.transport.emitRaw({
        type: "game-state",
        state: "no-game",
        scene: "MAINMENU",
      });
    });
    expect(getAutoRecordStatus().recording).toBe(false);

    // Another save loads, behind the earlier one on the clock; its flight is announced after.
    end(rig, 1, "gA", 2 /* Reverted */);
    start(rig, 1, { flightId: "gB", vesselId: "vB", vesselName: "Bravo" });
    tickFrame(rig, 2, "vB", "Bravo", "gB");
    expect(getAutoRecordStatus().vesselName).toBe("Bravo");
    end(rig, 3, "gB", 0 /* Recovered */);

    await vi.waitFor(async () => {
      const flights = await rig.source.listFlights();
      expect(flights).toHaveLength(2);
      const alpha = flights.find((f) => f.vesselName === "Alpha");
      expect(alpha?.endReason).toBe(2);
      expect(alpha?.lastFrameUt).toBeLessThan(10);
      expect(flights.find((f) => f.vesselName === "Bravo")?.endReason).toBe(0);
    });
  });

  it("a re-announce of the flight already being recorded does not split it into two missions", async () => {
    // A reconnect mid-flight: the host has no way to tell a returning
    // subscriber from a new one, so it re-announces. Same flight id AND same
    // start UT, so this controller holds its open session.
    const rig = buildRig();
    const { rerender } = render(
      <TelemetryProvider client={rig.client} store={rig.store}>
        <AutoRecordController missionHistoryEnabled />
      </TelemetryProvider>,
    );

    start(rig, 0, { flightId: "vA", vesselId: "vA", vesselName: "Alpha" });
    tickFrame(rig, 10, "vA", "Alpha");
    tickFrame(rig, 20, "vA", "Alpha");
    const frameCount = getAutoRecordStatus().frameCount;

    start(rig, 0, { flightId: "vA", vesselId: "vA", vesselName: "Alpha" });

    // Nothing saved and nothing restarted: one continuous recording.
    expect(await rig.source.listFlights()).toEqual([]);
    expect(getAutoRecordStatus().recording).toBe(true);
    expect(getAutoRecordStatus().frameCount).toBeGreaterThanOrEqual(frameCount);

    tickFrame(rig, 30, "vA", "Alpha");
    act(() => {
      rerender(
        <TelemetryProvider client={rig.client} store={rig.store}>
          <AutoRecordController missionHistoryEnabled={false} />
        </TelemetryProvider>,
      );
    });

    const flights = await rig.source.listFlights();
    expect(flights).toHaveLength(1);
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

    // flight.started still fires (and is tracked) even while disabled -- only the actual recorder.start() is gated.
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

  it("reports a finished flight the store refused, and clears the report once a later one is stored", async () => {
    const rig = buildRig();
    render(
      <TelemetryProvider client={rig.client} store={rig.store}>
        <AutoRecordController missionHistoryEnabled />
      </TelemetryProvider>,
    );
    const save = vi
      .spyOn(rig.missionStore, "saveMissionPart")
      .mockRejectedValueOnce(new Error("QuotaExceededError"));

    start(rig, 0, { flightId: "vA", vesselId: "vA", vesselName: "Alpha" });
    tickFrame(rig, 5, "vA", "Alpha");
    end(rig, 5, "vA");

    await vi.waitFor(() =>
      expect(getAutoRecordStatus().saveFailure).toEqual({
        vesselName: "Alpha",
        cause: "QuotaExceededError",
      }),
    );

    start(rig, 10, { flightId: "vB", vesselId: "vB", vesselName: "Bravo" });
    tickFrame(rig, 15, "vB", "Bravo");
    end(rig, 15, "vB");

    await vi.waitFor(() =>
      expect(getAutoRecordStatus().saveFailure).toBeNull(),
    );
    expect(save).toHaveBeenCalledTimes(2);
  });

  describe("a flight too long to store whole", () => {
    /** Small enough that every couple of ticks fills a part. */
    const tree = (rig: Rig) => (
      <TelemetryProvider client={rig.client} store={rig.store}>
        <AutoRecordController missionHistoryEnabled partSizeLimit={600} />
      </TelemetryProvider>
    );
    /**
     * Waits out every store write the test started. The status the controller
     * reports to is shared by the whole file, so a write still in flight when a
     * test ends would land in the next one.
     */
    const settled = async (save: {
      mock: { results: { value: unknown }[] };
    }): Promise<void> => {
      // A part is written once the one before it is, so more calls can follow the ones in hand.
      let issued = -1;
      while (issued !== save.mock.results.length) {
        issued = save.mock.results.length;
        await Promise.allSettled(
          save.mock.results.map((result) => result.value),
        );
        await act(async () => {});
      }
    };
    const utOf = (frame: string): number => {
      const parsed: { meta: { deliveredAt: number } } = JSON.parse(frame);
      return parsed.meta.deliveredAt;
    };

    it("is stored in parts that list as one flight and replay as one continuous timeline", async () => {
      const rig = buildRig();
      const save = vi.spyOn(rig.missionStore, "saveMissionPart");
      render(tree(rig));

      start(rig, 0, { flightId: "vA", vesselId: "vA", vesselName: "Alpha" });
      for (let ut = 1; ut <= 12; ut += 1) tickFrame(rig, ut, "vA", "Alpha");
      end(rig, 12, "vA");
      await vi.waitFor(async () =>
        expect(await rig.source.listFlights()).toHaveLength(1),
      );
      await settled(save);

      expect(save.mock.calls.length).toBeGreaterThanOrEqual(2);
      expect(save.mock.calls.map(([, part]) => part)).toEqual(
        save.mock.calls.map((_, index) => index),
      );
      const [flight] = await rig.source.listFlights();
      const { frames } = await rig.source.exportFlight(flight?.id ?? "");
      // Every frame of every part, once each, in the order it arrived.
      expect(frames).toHaveLength(flight?.sampleCount ?? -1);
      expect(new Set(frames).size).toBe(frames.length);
      const arrived = frames.map(utOf);
      expect(arrived).toEqual([...arrived].sort((a, b) => a - b));
      // Recording starts on the frame that announces the flight, so the first one kept is the tick after it.
      expect(arrived[0]).toBe(1);
      expect(arrived[arrived.length - 1]).toBe(12);
      expect(flight).toMatchObject({ firstFrameUt: 1, lastFrameUt: 12 });
      // And it plays as one: the altitude series runs from the first tick to the last.
      const range = await rig.source.queryRange(
        "vessel.identity.name",
        0,
        12,
        flight?.id,
      );
      expect(range.t[0]).toBe(1);
      expect(range.t[range.t.length - 1]).toBe(12);
      await settled(save);
    });

    it("counts the frames of the whole flight while it records, not of the part in hand", async () => {
      const rig = buildRig();
      const save = vi.spyOn(rig.missionStore, "saveMissionPart");
      render(tree(rig));

      start(rig, 0, { flightId: "vA", vesselId: "vA", vesselName: "Alpha" });
      const counts: number[] = [];
      for (let ut = 1; ut <= 12; ut += 1) {
        tickFrame(rig, ut, "vA", "Alpha");
        counts.push(getAutoRecordStatus().frameCount);
      }

      expect(counts).toEqual([...counts].sort((a, b) => a - b));
      expect(counts[counts.length - 1]).toBeGreaterThanOrEqual(24);
      await settled(save);
    });

    it("reports a part the store refused and still stores the parts after it", async () => {
      const rig = buildRig();
      const save = vi
        .spyOn(rig.missionStore, "saveMissionPart")
        .mockRejectedValueOnce(new Error("QuotaExceededError"));
      render(tree(rig));

      start(rig, 0, { flightId: "vA", vesselId: "vA", vesselName: "Alpha" });
      for (let ut = 1; ut <= 12; ut += 1) tickFrame(rig, ut, "vA", "Alpha");
      end(rig, 12, "vA");
      await settled(save);

      expect(save.mock.calls.length).toBeGreaterThanOrEqual(2);
      const [flight] = await rig.source.listFlights();
      const { frames } = await rig.source.exportFlight(flight?.id ?? "");
      // What is stored starts after the part that was lost, and runs to the end.
      expect(frames.length).toBeGreaterThan(0);
      expect(utOf(frames[0] ?? "")).toBeGreaterThan(1);
      expect(utOf(frames[frames.length - 1] ?? "")).toBe(12);
      // The loss is still on show: storing the later parts of the same flight does not clear it.
      expect(getAutoRecordStatus().saveFailure).toEqual({
        vesselName: "Alpha",
        cause: "QuotaExceededError",
      });
    });
  });

  it("stores the part in hand once a minute of page time has passed, so a closed tab loses at most that", async () => {
    const rig = buildRig();
    const save = vi.spyOn(rig.missionStore, "saveMissionPart");
    let pageMs = 0;
    const pageClock = vi
      .spyOn(performance, "now")
      .mockImplementation(() => pageMs);
    try {
      render(
        <TelemetryProvider client={rig.client} store={rig.store}>
          <AutoRecordController missionHistoryEnabled />
        </TelemetryProvider>,
      );

      start(rig, 0, { flightId: "vA", vesselId: "vA", vesselName: "Alpha" });
      for (let ut = 1; ut <= 5; ut += 1) tickFrame(rig, ut, "vA", "Alpha");
      expect(save).not.toHaveBeenCalled();

      pageMs = 60_000;
      tickFrame(rig, 6, "vA", "Alpha");
      expect(save).toHaveBeenCalledTimes(1);
      expect(getAutoRecordStatus().recording).toBe(true);

      // The next part is timed from the one just stored.
      pageMs = 90_000;
      tickFrame(rig, 7, "vA", "Alpha");
      expect(save).toHaveBeenCalledTimes(1);

      await Promise.allSettled(save.mock.results.map((result) => result.value));
      const [flight] = await rig.source.listFlights();
      expect(flight).toMatchObject({ firstFrameUt: 1, lastFrameUt: 6 });
    } finally {
      pageClock.mockRestore();
    }
    await act(async () => {});
  });

  it("does not start recording a flight that has ended when the master switch is turned back on", async () => {
    const rig = buildRig();
    const tree = (enabled: boolean) => (
      <TelemetryProvider client={rig.client} store={rig.store}>
        <AutoRecordController missionHistoryEnabled={enabled} />
      </TelemetryProvider>
    );
    const { rerender } = render(tree(true));

    start(rig, 0, { flightId: "vA", vesselId: "vA", vesselName: "Alpha" });
    tickFrame(rig, 5, "vA", "Alpha");
    end(rig, 5, "vA");
    expect(await rig.source.listFlights()).toHaveLength(1);

    act(() => rerender(tree(false)));
    act(() => rerender(tree(true)));

    expect(getAutoRecordStatus().recording).toBe(false);
  });

  it("names Recovered on the row of a flight recovered in contact while its recording is still being written", async () => {
    const rig = buildRig();
    const real = rig.missionStore.saveMissionPart.bind(rig.missionStore);
    vi.spyOn(rig.missionStore, "saveMissionPart").mockImplementation(
      async (...args) => {
        await new Promise((resolve) => setTimeout(resolve, 60));
        return real(...args);
      },
    );
    const tree = (scene: "Flight" | "SpaceCenter") => (
      <TelemetryProvider client={rig.client} store={rig.store}>
        <AutoRecordController missionHistoryEnabled scene={scene} />
      </TelemetryProvider>
    );
    const { rerender } = render(tree("Flight"));

    start(rig, 0, { flightId: "vA", vesselId: "vA", vesselName: "Alpha" });
    tickFrame(rig, 5, "vA", "Alpha");
    // Recovery is a scene change: the recording is closed, and the end is announced a moment later.
    act(() => rerender(tree("SpaceCenter")));
    end(rig, 8, "vA", 0 /* Recovered */);

    await vi.waitFor(async () => {
      const flights = await rig.source.listFlights();
      expect(flights).toHaveLength(1);
      expect(flights[0]?.endReason).toBe(0);
    });
  });

  it("resumes the tracked flight when the operator leaves the Flight scene and returns to the same vessel", async () => {
    const rig = buildRig();
    const tree = (scene: "Flight" | "SpaceCenter") => (
      <TelemetryProvider client={rig.client} store={rig.store}>
        <AutoRecordController missionHistoryEnabled scene={scene} />
      </TelemetryProvider>
    );
    const { rerender } = render(tree("Flight"));

    start(rig, 0, { flightId: "vA", vesselId: "vA", vesselName: "Alpha" });
    tickFrame(rig, 5, "vA", "Alpha");
    act(() => rerender(tree("SpaceCenter")));
    expect(getAutoRecordStatus().recording).toBe(false);
    expect(await rig.source.listFlights()).toHaveLength(1);

    // Back in flight, and the mod says nothing new: only its ticks name the vessel.
    act(() => rerender(tree("Flight")));
    tickFrame(rig, 60, "vA", "Alpha");

    expect(getAutoRecordStatus().recording).toBe(true);
    expect(getAutoRecordStatus().vesselName).toBe("Alpha");
  });

  it("notes on the flight's row the kerbals who went on EVA from its vessel", async () => {
    const rig = buildRig();
    render(
      <TelemetryProvider client={rig.client} store={rig.store}>
        <AutoRecordController missionHistoryEnabled />
      </TelemetryProvider>,
    );

    start(rig, 0, { flightId: "vA", vesselId: "vA", vesselName: "Alpha" });
    tickFrame(rig, 5, "vA", "Alpha");
    for (const [ut, onEva, name] of [
      [6, true, "Jebediah Kerman"],
      [7, true, "Jebediah Kerman"],
      [8, false, null],
      [9, true, "Valentina Kerman"],
    ] as const) {
      act(() => {
        rig.transport.emit(
          "flight.current",
          {
            flightId: "vA",
            vesselId: "vA",
            vesselName: "Alpha",
            phase: 0,
            onEva,
            evaKerbalName: name,
          },
          { validAt: ut, deliveredAt: ut },
        );
        rig.clock.scrubTo(ut);
        rig.raf.flush();
      });
    }
    end(rig, 12, "vA", 0 /* Recovered */);

    await vi.waitFor(async () => {
      const flights = await rig.source.listFlights();
      expect(flights[0]?.evaKerbals).toEqual([
        "Jebediah Kerman",
        "Valentina Kerman",
      ]);
    });
  });

  it("does not resume the tracked flight when the operator returns to a different vessel", () => {
    const rig = buildRig();
    const tree = (scene: "Flight" | "SpaceCenter") => (
      <TelemetryProvider client={rig.client} store={rig.store}>
        <AutoRecordController missionHistoryEnabled scene={scene} />
      </TelemetryProvider>
    );
    const { rerender } = render(tree("Flight"));

    start(rig, 0, { flightId: "vA", vesselId: "vA", vesselName: "Alpha" });
    act(() => rerender(tree("SpaceCenter")));
    act(() => rerender(tree("Flight")));
    tickFrame(rig, 60, "vB", "Bravo");

    expect(getAutoRecordStatus().recording).toBe(false);
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
    start(rig, 2, { flightId: "vA-2", vesselId: "vA", vesselName: "Alpha" });

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
    tickFrame(rig, 5, "vA", "Alpha", "vA-2");
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

  it("keeps no launch name for a flight that was never renamed", async () => {
    const rig = buildRig();
    render(
      <TelemetryProvider client={rig.client} store={rig.store}>
        <AutoRecordController missionHistoryEnabled />
      </TelemetryProvider>,
    );

    start(rig, 0, { flightId: "vA", vesselId: "vA", vesselName: "Alpha" });
    tickFrame(rig, 5, "vA", "Alpha");
    end(rig, 15, "vA", 0 /* Recovered */);

    await vi.waitFor(async () => {
      const flights = await rig.source.listFlights();
      expect(flights[0]?.vesselName).toBe("Alpha");
    });
    expect((await rig.source.listFlights())[0]?.launchName).toBeUndefined();
  });

  it("lists a renamed flight under its current name and keeps the launch name", async () => {
    const rig = buildRig();
    render(
      <TelemetryProvider client={rig.client} store={rig.store}>
        <AutoRecordController missionHistoryEnabled />
      </TelemetryProvider>,
    );

    start(rig, 0, { flightId: "vA", vesselId: "vA", vesselName: "Alpha" });
    tickFrame(rig, 5, "vA", "Alpha");
    tickFrame(rig, 10, "vA", "Alpha Two");
    end(rig, 15, "vA", 0 /* Recovered */);

    await vi.waitFor(async () => {
      const flights = await rig.source.listFlights();
      expect(flights).toHaveLength(1);
      expect(flights[0]?.vesselName).toBe("Alpha Two");
      expect(flights[0]?.launchName).toBe("Alpha");
    });
  });

  it("stores the reason a flight ended on the mission", async () => {
    const rig = buildRig();
    render(
      <TelemetryProvider client={rig.client} store={rig.store}>
        <AutoRecordController missionHistoryEnabled />
      </TelemetryProvider>,
    );

    start(rig, 0, { flightId: "vA", vesselId: "vA", vesselName: "Alpha" });
    tickFrame(rig, 5, "vA", "Alpha");
    end(rig, 10, "vA", 1 /* Crashed */);

    const flights = await rig.source.listFlights();
    expect(flights).toHaveLength(1);
    expect(flights[0]?.endReason).toBe(1);
  });

  it("leaves the reason absent for a recording that stopped without an end notice", async () => {
    const rig = buildRig();
    const tree = (scene: "Flight" | "SpaceCenter") => (
      <TelemetryProvider client={rig.client} store={rig.store}>
        <AutoRecordController missionHistoryEnabled scene={scene} />
      </TelemetryProvider>
    );
    const { rerender } = render(tree("Flight"));

    start(rig, 0, { flightId: "vA", vesselId: "vA", vesselName: "Alpha" });
    tickFrame(rig, 5, "vA", "Alpha");
    act(() => rerender(tree("SpaceCenter")));

    const flights = await rig.source.listFlights();
    expect(flights).toHaveLength(1);
    expect(flights[0]?.endReason).toBeUndefined();
  });

  it("puts a reason announced after the operator left the flight scene on the mission already stored", async () => {
    const rig = buildRig();
    const tree = (scene: "Flight" | "SpaceCenter") => (
      <TelemetryProvider client={rig.client} store={rig.store}>
        <AutoRecordController missionHistoryEnabled scene={scene} />
      </TelemetryProvider>
    );
    const { rerender } = render(tree("Flight"));

    start(rig, 0, { flightId: "vA", vesselId: "vA", vesselName: "Alpha" });
    tickFrame(rig, 5, "vA", "Alpha");
    act(() => rerender(tree("SpaceCenter")));
    expect(await rig.source.listFlights()).toHaveLength(1);

    end(rig, 60, "vA", 0 /* Recovered */);

    await vi.waitFor(async () => {
      const flights = await rig.source.listFlights();
      expect(flights).toHaveLength(1);
      expect(flights[0]?.endReason).toBe(0);
    });
  });

  it("keeps a crash as the end of its flight when a revert announces the same flight again, and records the flight the revert starts apart", async () => {
    // The shape the rig recorded: a crash 11 s into the flight, then Revert
    // to Launch from the Flight Results dialog, which announced the crashed
    // flight a second time as Reverted. The second flight is the one a revert
    // starts. The stub stream delivers each topic in time order, so the
    // revert's frames sit after the crash here instead of at the revert target.
    const rig = buildRig();
    render(
      <TelemetryProvider client={rig.client} store={rig.store}>
        <AutoRecordController missionHistoryEnabled />
      </TelemetryProvider>,
    );
    const crashed = "d08d78ab-0000-0000-0000-000000000001";
    const reverted = "d08d78ab-0000-0000-0000-000000000002";
    const vesselId = "d08d78ab-0000-0000-0000-000000000000";

    start(rig, 91235.99, {
      flightId: crashed,
      vesselId,
      vesselName: "ComSat Lx",
    });
    tickFrame(rig, 91240, vesselId, "ComSat Lx", crashed);
    end(rig, 91246.99, crashed, 1 /* Crashed */);
    end(rig, 91247.26, crashed, 2 /* Reverted */);
    start(rig, 91247.26, {
      flightId: reverted,
      vesselId,
      vesselName: "ComSat Lx",
    });
    tickFrame(rig, 91250, vesselId, "ComSat Lx", reverted);

    expect(getAutoRecordStatus().recording).toBe(true);
    end(rig, 91260, reverted, 2 /* Reverted */);

    const flights = await rig.source.listFlights();
    expect(flights).toHaveLength(2);
    expect(flights.map((f) => f.endReason).sort()).toEqual([1, 2]);
  });

  it("lists a renamed flight under its current name and keeps the launch name", async () => {
    const rig = buildRig();
    render(
      <TelemetryProvider client={rig.client} store={rig.store}>
        <AutoRecordController missionHistoryEnabled />
      </TelemetryProvider>,
    );

    start(rig, 0, { flightId: "vA", vesselId: "vA", vesselName: "Alpha" });
    tickFrame(rig, 5, "vA", "Alpha");
    tickFrame(rig, 10, "vA", "Alpha Two");
    end(rig, 15, "vA", 0 /* Recovered */);

    await vi.waitFor(async () => {
      const flights = await rig.source.listFlights();
      expect(flights).toHaveLength(1);
      expect(flights[0]?.vesselName).toBe("Alpha Two");
      expect(flights[0]?.launchName).toBe("Alpha");
    });
  });

  it("keeps no launch name for a flight that was never renamed", async () => {
    const rig = buildRig();
    render(
      <TelemetryProvider client={rig.client} store={rig.store}>
        <AutoRecordController missionHistoryEnabled />
      </TelemetryProvider>,
    );

    start(rig, 0, { flightId: "vA", vesselId: "vA", vesselName: "Alpha" });
    tickFrame(rig, 5, "vA", "Alpha");
    end(rig, 15, "vA", 0 /* Recovered */);

    await vi.waitFor(async () => {
      const flights = await rig.source.listFlights();
      expect(flights[0]?.vesselName).toBe("Alpha");
    });
    expect((await rig.source.listFlights())[0]?.launchName).toBeUndefined();
  });

  it("puts the reason a flight ended on its mission when focus had already moved to another vessel", async () => {
    const rig = buildRig();
    render(
      <TelemetryProvider client={rig.client} store={rig.store}>
        <AutoRecordController missionHistoryEnabled />
      </TelemetryProvider>,
    );

    start(rig, 0, { flightId: "vA", vesselId: "vA", vesselName: "Alpha" });
    tickFrame(rig, 5, "vA", "Alpha");
    start(rig, 10, { flightId: "vB", vesselId: "vB", vesselName: "Bravo" });
    tickFrame(rig, 15, "vB", "Bravo");

    end(rig, 20, "vA", 0 /* Recovered */);

    await vi.waitFor(async () => {
      const alpha = (await rig.source.listFlights()).find(
        (f) => f.vesselName === "Alpha",
      );
      expect(alpha?.endReason).toBe(0);
    });
    expect(getAutoRecordStatus().recording).toBe(true);
  });

  it("reopens a flight's mission when focus moves back to it, and records into it", async () => {
    const rig = buildRig();
    render(
      <TelemetryProvider client={rig.client} store={rig.store}>
        <AutoRecordController missionHistoryEnabled scene="Flight" />
      </TelemetryProvider>,
    );

    start(rig, 0, { flightId: "vA", vesselId: "vA", vesselName: "Alpha" });
    tickFrame(rig, 5, "vA", "Alpha");
    start(rig, 10, { flightId: "vB", vesselId: "vB", vesselName: "Bravo" });
    tickFrame(rig, 15, "vB", "Bravo");
    act(() => {
      rig.transport.emit(
        "flight.vesselChanged",
        {
          flightId: "vA",
          vesselId: "vA",
          vesselName: "Alpha",
          previousVesselId: "vB",
          ut: 20,
        },
        { validAt: 20, deliveredAt: 20 },
      );
    });
    tickFrame(rig, 25, "vA", "Alpha");
    tickFrame(rig, 30, "vA", "Alpha");

    expect(getAutoRecordStatus().recording).toBe(true);
    expect(getAutoRecordStatus().vesselName).toBe("Alpha");
    end(rig, 35, "vA", 0 /* Recovered */);

    await vi.waitFor(async () => {
      const flights = await rig.source.listFlights();
      const alpha = flights.filter((f) => f.vesselName === "Alpha");
      expect(alpha).toHaveLength(1);
      expect(alpha[0]?.endReason).toBe(0);
      expect(alpha[0]?.sampleCount).toBeGreaterThan(2);
    });
    expect(
      (await rig.source.listFlights()).filter((f) => f.vesselName === "Bravo"),
    ).toHaveLength(1);
  });

  it("keeps one mission for a flight when the operator leaves the Flight scene and returns", async () => {
    const rig = buildRig();
    const tree = (scene: "Flight" | "SpaceCenter") => (
      <TelemetryProvider client={rig.client} store={rig.store}>
        <AutoRecordController missionHistoryEnabled scene={scene} />
      </TelemetryProvider>
    );
    const { rerender } = render(tree("Flight"));

    start(rig, 0, { flightId: "vA", vesselId: "vA", vesselName: "Alpha" });
    tickFrame(rig, 5, "vA", "Alpha");
    act(() => rerender(tree("SpaceCenter")));
    act(() => rerender(tree("Flight")));
    tickFrame(rig, 60, "vA", "Alpha");
    end(rig, 65, "vA", 0 /* Recovered */);

    await vi.waitFor(async () => {
      const flights = await rig.source.listFlights();
      expect(flights).toHaveLength(1);
      expect(flights[0]?.endReason).toBe(0);
    });
  });

  it("stores the craft a docked flight joined on its mission", async () => {
    const rig = buildRig();
    render(
      <TelemetryProvider client={rig.client} store={rig.store}>
        <AutoRecordController missionHistoryEnabled />
      </TelemetryProvider>,
    );

    start(rig, 0, { flightId: "vB", vesselId: "vB", vesselName: "Bravo" });
    tickFrame(rig, 5, "vB", "Bravo");
    act(() => {
      rig.transport.emit(
        "flight.ended",
        {
          flightId: "vB",
          vesselId: "vB",
          vesselName: "Bravo",
          reason: 5 /* Docked */,
          ut: 9,
          joinedVesselId: "vA",
          joinedVesselName: "Alpha",
        },
        { validAt: 9, deliveredAt: 9 },
      );
      rig.clock.scrubTo(9);
      rig.raf.flush();
    });

    await vi.waitFor(async () => {
      const flights = await rig.source.listFlights();
      expect(flights[0]?.endReason).toBe(5);
      expect(flights[0]?.joinedVesselId).toBe("vA");
      expect(flights[0]?.joinedVesselName).toBe("Alpha");
    });
  });
});
