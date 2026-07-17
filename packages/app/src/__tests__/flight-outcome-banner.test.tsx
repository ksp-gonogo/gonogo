import {
  createFakeWallClock,
  StubTransport,
  TelemetryClient,
  TelemetryProvider,
  TimelineStore,
  ViewClock,
} from "@ksp-gonogo/sitrep-client";
import { act, render, screen } from "@ksp-gonogo/test-utils";
import { ModalProvider } from "@ksp-gonogo/ui";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FlightOutcomeBanner } from "../components/FlightOutcomeBanner";
import {
  BURNUP_DESTROYED,
  SHIP_CRASH_SPLASHDOWN,
} from "./fixtures/crash-payloads";

// FlightOutcomeBanner reads recovery.*/crash.* straight off the mod-side
// stream — `recovery.lastSummary`/`crash.lastCrash` via the canonical
// `useTelemetry(<topic>)` and the `recovery.hasRecent`/`crash.hasRecent`
// event flags via `useStream`. There is NO legacy "data" `DataSource` in the
// app (deleted in `806e7fe2`), so the test drives a real `TelemetryProvider`
// (`TelemetryClient` + `TimelineStore` over a `StubTransport`) — mirrors
// `packages/components/src/test/setupStreamFixture.tsx`, hand-rolled here in
// miniature (no shared test-helper package to import from). The sticky
// crash/recovery events emit at the default `validAt: 0`, so pinning the view
// clock at UT 10 makes any emitted event visible; a manual `store.beginFrame()`
// advances the pinned frame synchronously, so the fixture works under the fake
// timers the auto-dismiss assertions need.
const OUTCOME_CHANNELS = [
  "recovery.hasRecent",
  "recovery.lastSummary",
  "crash.hasRecent",
  "crash.lastCrash",
];

function setupOutcomeStream() {
  const wall = createFakeWallClock();
  const transport = new StubTransport();
  const client = new TelemetryClient(transport);
  const clock = new ViewClock({
    nowWall: wall.now,
    warpRate: () => 1,
    delaySeconds: () => 0,
  });
  const store = new TimelineStore(clock);
  clock.scrubTo(10);

  function Provider({ children }: { children: ReactNode }) {
    return (
      <ModalProvider>
        <TelemetryProvider
          client={client}
          store={store}
          carriedChannels={OUTCOME_CHANNELS}
        >
          {children}
        </TelemetryProvider>
      </ModalProvider>
    );
  }

  return {
    Provider,
    store,
    emit: (topic: string, payload: unknown) => transport.emit(topic, payload),
  };
}

describe("FlightOutcomeBanner", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // Reproduction of the user-reported bug from 2026-05-12. Live curl on
  // 2026-05-13 confirmed the fork DOES emit crash.lastCrash + has
  // crash.hasRecent=true after a crash — so the silent banner was a
  // gonogo-side effect-ordering bug.
  it("fires the crash banner when crash.lastCrash arrives after mount", () => {
    const fixture = setupOutcomeStream();

    render(
      <fixture.Provider>
        <FlightOutcomeBanner />
      </fixture.Provider>,
    );

    // Pre-crash: nothing on screen.
    expect(screen.queryByText(/VESSEL DESTROYED/)).toBeNull();

    // Crash data arrives — banner should pop. Real recorded Ship-crash payload.
    act(() => {
      fixture.emit("crash.hasRecent", true);
      fixture.emit("crash.lastCrash", SHIP_CRASH_SPLASHDOWN);
      fixture.store.beginFrame();
    });

    expect(screen.getByText(/VESSEL DESTROYED/)).toBeInTheDocument();
    expect(screen.getByText("career-orbital-test")).toBeInTheDocument();
  });

  // Real re-entry burn-up (eventKind "Destroyed") — fires no onCrash in KSP, so
  // the onVesselWillDestroy detector is what records it. The banner must surface
  // it like any other crash.
  it("fires the crash banner for a re-entry burn-up (eventKind Destroyed)", () => {
    const fixture = setupOutcomeStream();

    render(
      <fixture.Provider>
        <FlightOutcomeBanner />
      </fixture.Provider>,
    );

    act(() => {
      fixture.emit("crash.hasRecent", true);
      fixture.emit("crash.lastCrash", BURNUP_DESTROYED);
      fixture.store.beginFrame();
    });

    expect(screen.getByText(/VESSEL DESTROYED/)).toBeInTheDocument();
    expect(screen.getByText("Perf Test 1")).toBeInTheDocument();
  });

  // Debris is filtered at the source (the fork), never by name in the banner.
  // Guard against anyone re-introducing name-based filtering here: a real
  // vessel the operator named "... Debris" must still fire.
  it("fires for a crash whose vessel name ends in Debris", () => {
    const fixture = setupOutcomeStream();

    render(
      <fixture.Provider>
        <FlightOutcomeBanner />
      </fixture.Provider>,
    );

    act(() => {
      fixture.emit("crash.hasRecent", true);
      fixture.emit("crash.lastCrash", {
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
      fixture.store.beginFrame();
    });

    expect(screen.getByText(/VESSEL DESTROYED/)).toBeInTheDocument();
    expect(screen.getByText("Project Debris")).toBeInTheDocument();
  });

  it("fires the recovery banner when recovery.lastSummary arrives", () => {
    const fixture = setupOutcomeStream();

    render(
      <fixture.Provider>
        <FlightOutcomeBanner />
      </fixture.Provider>,
    );

    act(() => {
      fixture.emit("recovery.hasRecent", true);
      fixture.emit("recovery.lastSummary", {
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
      fixture.store.beginFrame();
    });

    expect(screen.getByText(/VESSEL RECOVERED/)).toBeInTheDocument();
    expect(screen.getByText("Untitled")).toBeInTheDocument();
  });

  it("does not re-fire when the same crash UT arrives again", () => {
    const fixture = setupOutcomeStream();

    render(
      <fixture.Provider>
        <FlightOutcomeBanner />
      </fixture.Provider>,
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
      fixture.emit("crash.hasRecent", true);
      fixture.emit("crash.lastCrash", crash);
      fixture.store.beginFrame();
    });
    expect(screen.getByText("Reusable")).toBeInTheDocument();

    // Bounce the visible window so the banner closes.
    act(() => {
      vi.advanceTimersByTime(11_000);
    });
    expect(screen.queryByText("Reusable")).toBeNull();

    // Re-emit with the SAME ut — idempotent, no banner.
    act(() => {
      fixture.emit("crash.lastCrash", crash);
      fixture.store.beginFrame();
    });
    expect(screen.queryByText("Reusable")).toBeNull();
  });
});
