import {
  clearRegistry,
  MockDataSource,
  registerDataSource,
} from "@ksp-gonogo/core";
import {
  createFakeWallClock,
  StubTransport,
  TelemetryClient,
  TelemetryProvider,
  TimelineStore,
  ViewClock,
} from "@ksp-gonogo/sitrep-client";
import { ModalProvider } from "@ksp-gonogo/ui";
import { act, cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FlightOutcomeBanner } from "../components/FlightOutcomeBanner";
import {
  BURNUP_DESTROYED,
  SHIP_CRASH_SPLASHDOWN,
} from "./fixtures/crash-payloads";

function Wrap({ children }: { children: ReactNode }) {
  return <ModalProvider>{children}</ModalProvider>;
}

// Mounts a real `TelemetryProvider` (`TelemetryClient` + `TimelineStore` over
// a `StubTransport`) — mirrors `telemetry-components.test.tsx`'s
// `setupTelemetryStream` (itself mirroring
// `packages/components/src/test/setupStreamFixture.tsx`), duplicated here in
// miniature for the same reason that file gives: no shared test-helper
// package to import from. Used by the "genuinely runs off the stream" describe
// block below — recovery.*/crash.* are `TELEMACHUS_CLEAN_HOMES` entries with
// NO `"data"` `DataSource` registered at all, proving the banner reads them
// off the mod-side stream rather than the legacy path the tests above exercise.
function setupTelemetryStream(carriedChannels: Iterable<string>) {
  const wall = createFakeWallClock();
  const transport = new StubTransport();
  const client = new TelemetryClient(transport);
  const clock = new ViewClock({
    nowWall: wall.now,
    warpRate: () => 1,
    delaySeconds: () => 0,
  });
  const store = new TimelineStore(clock);
  // Pin the view clock so `store.sample(topic, currentFrame())` resolves —
  // without a fixed frame the clock has no confirmed edge and every sample
  // reads back `undefined` (the exact reason `setupStreamFixture` pins too).
  // The sticky crash/recovery events emit at the default `validAt: 0`, so any
  // pinned UT >= 0 sees them.
  clock.scrubTo(10);

  function Provider({ children }: { children: ReactNode }) {
    return (
      <ModalProvider>
        <TelemetryProvider
          client={client}
          store={store}
          carriedChannels={carriedChannels}
        >
          {children}
        </TelemetryProvider>
      </ModalProvider>
    );
  }

  return {
    emit: (topic: string, payload: unknown) => transport.emit(topic, payload),
    Provider,
  };
}

describe("FlightOutcomeBanner", () => {
  beforeEach(() => {
    clearRegistry();
    vi.useFakeTimers();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  // Reproduction of the user-reported bug from 2026-05-12. Live curl on
  // 2026-05-13 confirmed the fork DOES emit crash.lastCrash + has
  // crash.hasRecent=true after a crash — so the silent banner was a
  // gonogo-side effect-ordering bug.
  it("fires the crash banner when crash.lastCrash arrives after mount", () => {
    const src = new MockDataSource({
      id: "data",
      keys: [
        { key: "recovery.hasRecent" },
        { key: "recovery.lastSummary" },
        { key: "crash.hasRecent" },
        { key: "crash.lastCrash" },
      ],
    });
    registerDataSource(src);
    src.setStatus("connected");

    render(
      <Wrap>
        <FlightOutcomeBanner />
      </Wrap>,
    );

    // Pre-crash: nothing on screen.
    expect(screen.queryByText(/VESSEL DESTROYED/)).toBeNull();

    // Crash data arrives — banner should pop. Real recorded Ship-crash payload.
    act(() => {
      src.emit("crash.hasRecent", true);
      src.emit("crash.lastCrash", SHIP_CRASH_SPLASHDOWN);
    });

    expect(screen.getByText(/VESSEL DESTROYED/)).toBeInTheDocument();
    expect(screen.getByText("career-orbital-test")).toBeInTheDocument();
  });

  // Real re-entry burn-up (eventKind "Destroyed") — fires no onCrash in KSP, so
  // the onVesselWillDestroy detector is what records it. The banner must surface
  // it like any other crash.
  it("fires the crash banner for a re-entry burn-up (eventKind Destroyed)", () => {
    const src = new MockDataSource({
      id: "data",
      keys: [
        { key: "recovery.hasRecent" },
        { key: "recovery.lastSummary" },
        { key: "crash.hasRecent" },
        { key: "crash.lastCrash" },
      ],
    });
    registerDataSource(src);
    src.setStatus("connected");

    render(
      <Wrap>
        <FlightOutcomeBanner />
      </Wrap>,
    );

    act(() => {
      src.emit("crash.hasRecent", true);
      src.emit("crash.lastCrash", BURNUP_DESTROYED);
    });

    expect(screen.getByText(/VESSEL DESTROYED/)).toBeInTheDocument();
    expect(screen.getByText("Perf Test 1")).toBeInTheDocument();
  });

  // Debris is filtered at the source (the fork), never by name in the banner.
  // Guard against anyone re-introducing name-based filtering here: a real
  // vessel the operator named "... Debris" must still fire.
  it("fires for a crash whose vessel name ends in Debris", () => {
    const src = new MockDataSource({
      id: "data",
      keys: [
        { key: "recovery.hasRecent" },
        { key: "recovery.lastSummary" },
        { key: "crash.hasRecent" },
        { key: "crash.lastCrash" },
      ],
    });
    registerDataSource(src);
    src.setStatus("connected");

    render(
      <Wrap>
        <FlightOutcomeBanner />
      </Wrap>,
    );

    act(() => {
      src.emit("crash.hasRecent", true);
      src.emit("crash.lastCrash", {
        ut: 9100,
        vesselName: "Project Debris",
        vesselType: "Ship",
        body: "Kerbin",
        situation: "FLYING",
        what: "Kerbin^N",
        partsLost: [{ partName: "mk1pod.v2" }],
        kerbalsKilled: [],
        crewAboard: [],
        flightStats: {
          highestAltitude: 0,
          highestSpeed: 0,
          highestGee: 0,
          groundDistance: 0,
        },
      });
    });

    expect(screen.getByText(/VESSEL DESTROYED/)).toBeInTheDocument();
    expect(screen.getByText("Project Debris")).toBeInTheDocument();
  });

  it("fires the recovery banner when recovery.lastSummary arrives", () => {
    const src = new MockDataSource({
      id: "data",
      keys: [
        { key: "recovery.hasRecent" },
        { key: "recovery.lastSummary" },
        { key: "crash.hasRecent" },
        { key: "crash.lastCrash" },
      ],
    });
    registerDataSource(src);
    src.setStatus("connected");

    render(
      <Wrap>
        <FlightOutcomeBanner />
      </Wrap>,
    );

    act(() => {
      src.emit("recovery.hasRecent", true);
      src.emit("recovery.lastSummary", {
        capturedAtUT: 2000,
        vesselName: "Untitled",
        recoveryLocation: "LaunchPad",
        recoveryFactor: "100%",
        scienceEarned: 0,
        totalScience: 5011,
        fundsEarned: 1035,
        totalFunds: 289848,
        reputationEarned: 0,
        totalReputation: 976,
        displayReputation: false,
        scienceBreakdown: [],
        partBreakdown: [],
        resourceBreakdown: [],
        crewBreakdown: [],
      });
    });

    expect(screen.getByText(/VESSEL RECOVERED/)).toBeInTheDocument();
    expect(screen.getByText("Untitled")).toBeInTheDocument();
  });

  it("does not re-fire when the same crash UT arrives again", () => {
    const src = new MockDataSource({
      id: "data",
      keys: [
        { key: "recovery.hasRecent" },
        { key: "recovery.lastSummary" },
        { key: "crash.hasRecent" },
        { key: "crash.lastCrash" },
      ],
    });
    registerDataSource(src);
    src.setStatus("connected");

    render(
      <Wrap>
        <FlightOutcomeBanner />
      </Wrap>,
    );

    const crash = {
      ut: 5000,
      vesselName: "Reusable",
      body: "Kerbin",
      situation: "LANDED",
      what: "ground",
      partsLost: [],
      kerbalsKilled: [],
      crewAboard: [],
      flightStats: {
        highestAltitude: 0,
        highestSpeed: 0,
        highestGee: 0,
        groundDistance: 0,
      },
    };
    act(() => {
      src.emit("crash.hasRecent", true);
      src.emit("crash.lastCrash", crash);
    });
    expect(screen.getByText("Reusable")).toBeInTheDocument();

    // Bounce the visible window so the banner closes.
    act(() => {
      vi.advanceTimersByTime(11_000);
    });
    expect(screen.queryByText("Reusable")).toBeNull();

    // Re-emit with the SAME ut — idempotent, no banner.
    act(() => {
      src.emit("crash.lastCrash", crash);
    });
    expect(screen.queryByText("Reusable")).toBeNull();
  });
});

describe("FlightOutcomeBanner — genuinely runs off the stream (P4c-b recovery.* topic build)", () => {
  // NOTE: real timers here, unlike the legacy-path describe above. The stream
  // read schedules its per-frame `beginFrame()` via a queued microtask/rAF
  // (`scheduleFrame` in `context.tsx`) — `vi.useFakeTimers()` freezes that, so
  // `store.currentFrame()` never advances and every sample reads back
  // `undefined`. The legacy `MockDataSource` path above is synchronous and so
  // is immune; the stream path is not. We only assert the banner appears, so
  // no timer control is needed.
  beforeEach(() => {
    clearRegistry();
  });

  afterEach(() => {
    cleanup();
  });

  it("fires the recovery banner from recovery.lastSummary/recovery.hasRecent with NO legacy data source registered", async () => {
    // No `registerDataSource` call at all here — proves the read comes off
    // the mod-side stream (RecoveryUplink), not a `"data"` legacy fallback.
    const fixture = setupTelemetryStream([
      "recovery.lastSummary",
      "recovery.hasRecent",
    ]);

    render(
      <fixture.Provider>
        <FlightOutcomeBanner />
      </fixture.Provider>,
    );

    expect(screen.queryByText(/VESSEL RECOVERED/)).toBeNull();

    await act(async () => {
      fixture.emit("recovery.hasRecent", true);
      fixture.emit("recovery.lastSummary", {
        capturedAtUT: 41520.75,
        vesselName: "career-orbital-test",
        recoveryLocation: "KSC",
        recoveryFactor: "100%",
        scienceEarned: 12.5,
        totalScience: 340.25,
        fundsEarned: 18500,
        totalFunds: 289848,
        reputationEarned: 4.2,
        totalReputation: 88.6,
        displayReputation: true,
        scienceBreakdown: [
          {
            subjectId: "crewReport@KerbinSrfLandedKSC",
            subjectTitle: "Crew Report from KSC",
            dataGathered: 5,
            scienceAmount: 2.5,
          },
        ],
        partBreakdown: [],
        resourceBreakdown: [],
        crewBreakdown: [
          {
            name: "Bill Kerman",
            trait: "Pilot",
            isTourist: false,
            xpGained: 1.2,
            levelsGained: 1,
            newLevel: 2,
          },
        ],
      });
      // Flush the microtask-scheduled `beginFrame()` (see `scheduleFrame`)
      // so `store.currentFrame()` advances and the sticky event resolves.
      await Promise.resolve();
    });

    expect(await screen.findByText(/VESSEL RECOVERED/)).toBeInTheDocument();
    expect(screen.getByText("career-orbital-test")).toBeInTheDocument();
    expect(screen.getByText("+18,500f")).toBeInTheDocument();
    expect(screen.getByText("+12.5 sci")).toBeInTheDocument();
    expect(screen.getByText("+4.2 rep")).toBeInTheDocument();
  });

  it("fires the crash banner from crash.lastCrash/crash.hasRecent with NO legacy data source registered", async () => {
    const fixture = setupTelemetryStream([
      "crash.lastCrash",
      "crash.hasRecent",
    ]);

    render(
      <fixture.Provider>
        <FlightOutcomeBanner />
      </fixture.Provider>,
    );

    await act(async () => {
      fixture.emit("crash.hasRecent", true);
      fixture.emit("crash.lastCrash", SHIP_CRASH_SPLASHDOWN);
      await Promise.resolve();
    });

    expect(await screen.findByText(/VESSEL DESTROYED/)).toBeInTheDocument();
    expect(screen.getByText("career-orbital-test")).toBeInTheDocument();
  });
});
