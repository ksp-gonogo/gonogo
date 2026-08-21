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
  fromReputationLoss,
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
    // `reason` is a FlightEndReason ORDINAL on the wire. This passed a string
    // no mod has ever sent, and asserted only the kind and the UT, so it
    // agreed with the bug that left `detail` permanently absent. See
    // flightEndReason.test.ts.
    const ev = fromFlightEnded({ ut: 200, reason: 0 });
    expect(ev).toMatchObject({ kind: "flight-ended", ut: 200 });
    expect(ev?.detail).toBe("Recovered");
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

describe("fromReputationLoss", () => {
  const loss = {
    vesselId: "v-1",
    vesselName: "Probe Kelnik-3",
    delta: -6,
    cause: "crew-loss",
    crewLost: ["Jebediah Kerman"],
    ut: 1000,
  };

  it("reads the delta, the cause, the vessel, the crew, and how old the news is", () => {
    // Revealed at 1312 for an event at 1000: the vessel was 312 light-seconds out, so
    // the row must read as a report, not as something happening now.
    const e = fromReputationLoss(loss, 1312);
    expect(e).toMatchObject({ kind: "reputation-loss", ut: 1000 });
    expect(e?.label).toBe("Reputation -6");
    expect(e?.detail).toContain("crew loss");
    expect(e?.detail).toContain("Probe Kelnik-3");
    expect(e?.detail).toContain("Jebediah Kerman");
    // The duration comes from the unit registry's seconds ladder via writeQuantity,
    // not from a hand-typed format: 312s renders as "5min 12s".
    expect(e?.detail).toContain("5min 12s ago");
  });

  it("keys the id on the vessel so two losses in the same instant stay distinct", () => {
    const a = fromReputationLoss(loss, 1000);
    const b = fromReputationLoss({ ...loss, vesselId: "v-2" }, 1000);
    expect(a?.id).not.toBe(b?.id);
  });

  it("drops a zero delta and anything unparseable", () => {
    // An uncrewed vessel costs no reputation in stock, so a zero-delta row would be noise.
    expect(fromReputationLoss({ ...loss, delta: 0 }, 1000)).toBeNull();
    expect(fromReputationLoss({ ...loss, ut: undefined }, 1000)).toBeNull();
    expect(fromReputationLoss(undefined, 1000)).toBeNull();
    expect(fromReputationLoss("nonsense", 1000)).toBeNull();
  });

  it("keeps the sign on a positive delta rather than losing it", () => {
    expect(fromReputationLoss({ ...loss, delta: 4 }, 1000)?.label).toBe(
      "Reputation +4",
    );
  });
});
