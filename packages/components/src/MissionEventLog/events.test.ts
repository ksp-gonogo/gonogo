import { describe, expect, it } from "vitest";
import {
  detectContractsCompleted,
  detectDocking,
  detectEva,
  detectScienceCollected,
  detectSoiChange,
  detectStaging,
  fromCrash,
  fromFlightEnded,
  fromFlightStarted,
  fromRecovery,
  fromVesselChanged,
  type MissionEvent,
} from "./events";

// --- Tier A: discrete-topic events (payload carries its own `ut`) ------------

describe("Tier A discrete-topic events", () => {
  it("shapes a launch event from flight.started", () => {
    const ev = fromFlightStarted({ ut: 100, vesselName: "Mun Tester" });
    expect(ev).toMatchObject({ kind: "launch", ut: 100 });
    expect(ev?.label).toContain("Mun Tester");
  });

  it("shapes a flight-ended event", () => {
    const ev = fromFlightEnded({ ut: 200, reason: "recovered" });
    expect(ev).toMatchObject({ kind: "flight-ended", ut: 200 });
  });

  it("shapes a vessel-changed event", () => {
    const ev = fromVesselChanged({ ut: 150, vesselName: "Relay 1" });
    expect(ev).toMatchObject({ kind: "vessel-changed", ut: 150 });
    expect(ev?.label).toContain("Relay 1");
  });

  it("shapes a crash event from crash.lastCrash", () => {
    const ev = fromCrash({ ut: 300, vesselName: "Booster", cause: "impact" });
    expect(ev).toMatchObject({ kind: "crash", ut: 300 });
  });

  it("shapes a recovery event from recovery.lastSummary", () => {
    const ev = fromRecovery({
      ut: 400,
      vesselName: "Capsule",
      fundsRecovered: 1200,
    });
    expect(ev).toMatchObject({ kind: "recovery", ut: 400 });
  });

  it("returns null for a missing/malformed discrete payload", () => {
    expect(fromFlightStarted(undefined)).toBeNull();
    expect(fromCrash({ vesselName: "x" })).toBeNull(); // no ut
  });

  it("gives every event a stable id keyed on kind+ut", () => {
    const a = fromFlightStarted({ ut: 100, vesselName: "A" }) as MissionEvent;
    const b = fromFlightStarted({ ut: 100, vesselName: "A" }) as MissionEvent;
    expect(a.id).toBe(b.id);
    expect(fromCrash({ ut: 100, vesselName: "A" })?.id).not.toBe(a.id);
  });
});

// --- Tier B: value-edge detectors (event `ut` supplied by the caller) ---------

describe("Tier B edge detectors", () => {
  it("staging: fires when currentStage decreases, not on increase/equal", () => {
    expect(detectStaging(3, 2, 500)).toMatchObject({
      kind: "staging",
      ut: 500,
    });
    expect(detectStaging(2, 2, 500)).toBeNull();
    expect(detectStaging(2, 3, 500)).toBeNull(); // stage count going up = new vessel/revert, not a staging edge
    expect(detectStaging(undefined, 5, 500)).toBeNull(); // first sample = no edge
  });

  it("soi-change: fires when referenceBodyIndex changes", () => {
    expect(detectSoiChange(1, 2, 600)).toMatchObject({
      kind: "soi-change",
      ut: 600,
    });
    expect(detectSoiChange(1, 1, 600)).toBeNull();
    expect(detectSoiChange(undefined, 1, 600)).toBeNull();
  });

  it("docking: fires docking on false→true, undocking on true→false", () => {
    expect(detectDocking(false, true, 700)).toMatchObject({
      kind: "docking",
      ut: 700,
    });
    expect(detectDocking(true, false, 700)).toMatchObject({
      kind: "undocking",
      ut: 700,
    });
    expect(detectDocking(true, true, 700)).toBeNull();
    expect(detectDocking(undefined, true, 700)).toBeNull();
  });

  it("eva: fires when vesselType transitions into EVA (7)", () => {
    expect(detectEva(0, 7, 800)).toMatchObject({ kind: "eva", ut: 800 });
    expect(detectEva(7, 7, 800)).toBeNull();
    expect(detectEva(7, 0, 800)).toBeNull(); // boarding back is not an EVA-start
  });

  it("contract-completed: fires one event per NEW completed contract id", () => {
    const prev = [{ id: "c1", title: "Orbit Kerbin" }];
    const curr = [
      { id: "c1", title: "Orbit Kerbin" },
      { id: "c2", title: "Land on Mun" },
    ];
    const evs = detectContractsCompleted(prev, curr, 900);
    expect(evs).toHaveLength(1);
    expect(evs[0]).toMatchObject({ kind: "contract-completed", ut: 900 });
    expect(evs[0].label).toContain("Land on Mun");
    expect(detectContractsCompleted(curr, curr, 900)).toHaveLength(0);
    expect(detectContractsCompleted(undefined, curr, 900)).toHaveLength(0); // first sample = no edge
  });

  it("science-collected: fires when the experiment-breakdown total grows", () => {
    expect(detectScienceCollected(10, 25, 1000)).toMatchObject({
      kind: "science-collected",
      ut: 1000,
    });
    expect(detectScienceCollected(25, 25, 1000)).toBeNull();
    expect(detectScienceCollected(25, 10, 1000)).toBeNull(); // total dropping (new flight) is not a collection
    expect(detectScienceCollected(undefined, 5, 1000)).toBeNull();
  });
});
