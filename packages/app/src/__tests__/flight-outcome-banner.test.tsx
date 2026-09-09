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
import { NULL_DISPLAY } from "@ksp-gonogo/ui-kit";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FlightOutcomeBanner } from "../components/FlightOutcomeBanner";
import {
  BURNUP_DESTROYED,
  SHIP_CRASH_SPLASHDOWN,
} from "./fixtures/crash-payloads";

// FlightOutcomeBanner reads recovery.*/crash.* straight off the mod-side
// stream: `recovery.lastSummary`/`crash.lastCrash` via the canonical
// `useTelemetry(<topic>)` and the `recovery.hasRecent`/`crash.hasRecent`
// event flags via `useStream`. There is NO legacy "data" `DataSource` in the
// app (deleted in `806e7fe2`), so the test drives a real `TelemetryProvider`
// (`TelemetryClient` + `TimelineStore` over a `StubTransport`): mirrors
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

// A detail-modal row is a label element beside a value element, and `Unit`
// splits its own output across several spans (magnitude, symbol, spoken word).
// Querying the label and asserting on its parent's text keeps the assertion
// about the number the operator reads rather than about the kit's markup.
function rowFor(label: string | RegExp): HTMLElement {
  const cell = screen.getByText(label);
  const row = cell.parentElement;
  if (!row) throw new Error(`no row around ${String(label)}`);
  return row;
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
  // crash.hasRecent=true after a crash: so the silent banner was a
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

    // Crash data arrives: banner should pop. Real recorded Ship-crash payload.
    act(() => {
      fixture.emit("crash.hasRecent", true);
      fixture.emit("crash.lastCrash", SHIP_CRASH_SPLASHDOWN);
      fixture.store.beginFrame();
    });

    expect(screen.getByText(/VESSEL DESTROYED/)).toBeInTheDocument();
    expect(screen.getByText("career-orbital-test")).toBeInTheDocument();
  });

  // Real re-entry burn-up (eventKind "Destroyed"): fires no onCrash in KSP, so
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
        recoveryFactor: "100 %",
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

  // Every quantity on both payloads is a `Value` by the time the banner reads
  // it, wrapped on decode from the generated unit maps.
  // A reader that tests `typeof v === "number"` therefore sees an object and
  // substitutes zero, so the banner reported every recovery as a total loss.
  it("renders the earnings a recovery actually paid, not zeros", () => {
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
        vesselName: "Kerbal I",
        recoveryLocation: "KSC",
        recoveryFactor: "100 %",
        scienceEarned: 12.5,
        totalScience: 5011,
        fundsEarned: 1035,
        totalFunds: 289848,
        reputationEarned: 7.5,
        totalReputation: 976,
        displayReputation: true,
        scienceBreakdown: [],
        partBreakdown: [],
        resourceBreakdown: [],
        crewBreakdown: [],
      });
      fixture.store.beginFrame();
    });

    const banner = screen.getByRole("status");
    expect(banner).toHaveTextContent("1,035");
    expect(banner).toHaveTextContent("12.5");
    expect(banner).toHaveTextContent("7.5");
  });

  // The breakdown modal reads the same payload one level down, and the unit
  // maps follow into the entry shapes.
  // Part `count` was the nastiest of them: `num(x.count) || 1` turned a group
  // of eight into "×1", with nothing to show the reader anything was dropped.
  it("renders the recovery breakdown rows with their real numbers", async () => {
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
        vesselName: "Kerbal I",
        recoveryLocation: "KSC",
        recoveryFactor: "100 %",
        scienceEarned: 12.5,
        totalScience: 5011,
        fundsEarned: 1035,
        totalFunds: 289848,
        reputationEarned: 0,
        totalReputation: 976,
        displayReputation: false,
        scienceBreakdown: [
          {
            subjectId: "crewReport@KerbinSrfLandedLaunchPad",
            subjectTitle: "Crew Report from the Launch Pad",
            dataGathered: 8,
            scienceAmount: 4.5,
          },
        ],
        partBreakdown: [
          {
            partName: "solidBooster",
            partTitle: "RT-10 Hammer",
            count: 8,
            partValue: 3200,
            resourcesValue: 90,
            totalValue: 3290,
          },
        ],
        resourceBreakdown: [],
        crewBreakdown: [],
      });
      fixture.store.beginFrame();
    });

    await act(async () => {
      screen.getByRole("status").click();
    });

    expect(rowFor(/RT-10 Hammer/)).toHaveTextContent("×8");
    expect(rowFor(/RT-10 Hammer/)).toHaveTextContent("3,290");
    expect(rowFor(/Crew Report from the Launch Pad/)).toHaveTextContent("4.5");
  });

  // Both UTs read 0 under the same substitution, so `crash.ut > recovery.ut`
  // was `0 > 0` and a flight that ended in a crater announced a recovery.
  // This is the sticky-outcome case: an earlier recovery is still on the
  // topic when the crash lands.
  it("picks the crash when it is newer than the sticky recovery", () => {
    const fixture = setupOutcomeStream();

    render(
      <fixture.Provider>
        <FlightOutcomeBanner />
      </fixture.Provider>,
    );

    act(() => {
      fixture.emit("recovery.hasRecent", true);
      fixture.emit("recovery.lastSummary", {
        capturedAtUT: 1000,
        vesselName: "Recovered Earlier",
        recoveryLocation: "KSC",
        recoveryFactor: "100 %",
        scienceEarned: 0,
        totalScience: 0,
        fundsEarned: 0,
        totalFunds: 0,
        reputationEarned: 0,
        totalReputation: 0,
        displayReputation: false,
        scienceBreakdown: [],
        partBreakdown: [],
        resourceBreakdown: [],
        crewBreakdown: [],
      });
      fixture.emit("crash.hasRecent", true);
      fixture.emit("crash.lastCrash", {
        ut: 9000,
        vesselName: "Crashed Later",
        vesselType: "Ship",
        body: "Kerbin",
        situation: "FLYING",
        what: "Kerbin",
        partsLost: [{ partName: "mk1pod.v2" }],
        kerbalsKilled: [],
        crewAboard: [],
        flightStats: {
          highestAltitude: 12400,
          highestSpeed: 620,
          highestGee: 4.2,
          groundDistance: 3100,
        },
      });
      fixture.store.beginFrame();
    });

    expect(screen.getByText(/VESSEL DESTROYED/)).toBeInTheDocument();
    expect(screen.getByText("Crashed Later")).toBeInTheDocument();
    expect(screen.queryByText(/VESSEL RECOVERED/)).toBeNull();
  });

  // The crash modal's flight statistics come off `flightStats`, wrapped by the
  // same walk one level down.
  it("renders the crash flight statistics rather than zeros", async () => {
    const fixture = setupOutcomeStream();

    render(
      <fixture.Provider>
        <FlightOutcomeBanner />
      </fixture.Provider>,
    );

    act(() => {
      fixture.emit("crash.hasRecent", true);
      fixture.emit("crash.lastCrash", {
        ut: 9000,
        vesselName: "Crashed Later",
        vesselType: "Ship",
        body: "Kerbin",
        situation: "FLYING",
        what: "Kerbin",
        partsLost: [{ partName: "mk1pod.v2" }],
        kerbalsKilled: [],
        crewAboard: [],
        flightStats: {
          highestAltitude: 12400,
          highestSpeed: 620,
          highestGee: 4.2,
          groundDistance: 3100,
        },
      });
      fixture.store.beginFrame();
    });

    await act(async () => {
      screen.getByRole("status").click();
    });

    expect(rowFor("Highest altitude")).toHaveTextContent("12.4");
    expect(rowFor("Highest speed")).toHaveTextContent("620");
    expect(rowFor("Highest G")).toHaveTextContent("4.20");
    expect(rowFor("Ground distance")).toHaveTextContent("3.1");
  });

  // The announce key is `(kind, ut)`, so a UT that always read 0 made every
  // crash look like the one already announced.
  // After the first, no crash banner ever fired again; the dedupe below is
  // only meaningful if a genuinely different UT still gets through.
  it("fires again for a second crash at a different UT", () => {
    const fixture = setupOutcomeStream();

    render(
      <fixture.Provider>
        <FlightOutcomeBanner />
      </fixture.Provider>,
    );

    const crash = (ut: number, vesselName: string) => ({
      ut,
      vesselName,
      vesselType: "Ship",
      body: "Kerbin",
      situation: "FLYING",
      what: "Kerbin",
      partsLost: [],
      kerbalsKilled: [],
      crewAboard: [],
      flightStats: {
        highestAltitude: 100,
        highestSpeed: 50,
        highestGee: 1,
        groundDistance: 0,
      },
    });

    act(() => {
      fixture.emit("crash.hasRecent", true);
      fixture.emit("crash.lastCrash", crash(4000, "First Loss"));
      fixture.store.beginFrame();
    });
    expect(screen.getByText("First Loss")).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(11_000);
    });
    expect(screen.queryByText("First Loss")).toBeNull();

    act(() => {
      fixture.emit("crash.lastCrash", crash(7000, "Second Loss"));
      fixture.store.beginFrame();
    });
    expect(screen.getByText("Second Loss")).toBeInTheDocument();
  });

  // A field the producer never sent is not a measurement of zero. The banner
  // says so rather than reporting a payout nobody received.
  it("says a missing quantity is unknown rather than reporting zero", () => {
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
        vesselName: "Partial Report",
        recoveryLocation: "KSC",
        recoveryFactor: "100 %",
        // fundsEarned deliberately absent.
        scienceEarned: 3,
        totalScience: 10,
        totalFunds: 100,
        reputationEarned: 0,
        totalReputation: 0,
        displayReputation: false,
        scienceBreakdown: [],
        partBreakdown: [],
        resourceBreakdown: [],
        crewBreakdown: [],
      });
      fixture.store.beginFrame();
    });

    const banner = screen.getByRole("status");
    expect(banner).toHaveTextContent(NULL_DISPLAY);
    expect(banner).not.toHaveTextContent("+0");
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

    // Re-emit with the SAME ut: idempotent, no banner.
    act(() => {
      fixture.emit("crash.lastCrash", crash);
      fixture.store.beginFrame();
    });
    expect(screen.queryByText("Reusable")).toBeNull();
  });
});
