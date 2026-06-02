import {
  clearRegistry,
  MockDataSource,
  registerDataSource,
} from "@gonogo/core";
import { ModalProvider } from "@gonogo/ui";
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
  // vessel the operator named "… Debris" must still fire.
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
