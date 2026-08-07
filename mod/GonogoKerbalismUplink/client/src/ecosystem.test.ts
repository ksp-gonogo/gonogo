import type {
  KerbalismLifeSupport,
  KerbalismProfile,
} from "@ksp-gonogo/sitrep-sdk";
import { value } from "@ksp-gonogo/sitrep-sdk";
import { describe, expect, it } from "vitest";
import {
  buildLedger,
  closedLoops,
  diagnose,
  resourceFacts,
  timeToEmptySeconds,
} from "./ecosystem";

// Real numbers from Kerbalism's stock profile config, trimmed to the processes
// and rules that matter here. Nothing below is invented except which converters
// this imaginary vessel carries and how full its tanks are, which is runtime
// state no fixture can supply.

const rate = (n: number) => value("units/s", n);

const PROFILE = {
  name: "Default",
  resources: {
    Water: {
      flowMode: "ALL_VESSEL",
      displayName: "Water",
      isSupply: true,
      lowThreshold: 0.15,
    },
    WasteWater: {
      flowMode: "ALL_VESSEL",
      displayName: "Waste Water",
      isSupply: false,
    },
    ElectricCharge: {
      flowMode: "ALL_VESSEL_BALANCE",
      displayName: "Electric Charge",
      isSupply: false,
    },
    Oxygen: { flowMode: "ALL_VESSEL", displayName: "Oxygen", isSupply: true },
    Hydrogen: {
      flowMode: "ALL_VESSEL",
      displayName: "Hydrogen",
      isSupply: false,
    },
    Ammonia: {
      flowMode: "ALL_VESSEL",
      displayName: "Ammonia",
      isSupply: false,
    },
    CarbonDioxide: {
      flowMode: "",
      displayName: "CarbonDioxide",
      isSupply: false,
    },
  },
  rules: [
    {
      name: "drinking",
      input: "Water",
      output: "WasteWater",
      // 0.03359375 once per 5400s. The mod already divided; nobody repeats it.
      ratePerSecond: rate(0.03359375 / 5400),
      rate: value("units", 0.03359375),
      interval: value("s", 5400),
    },
    // A pure accumulator: models a hazard, moves no resource, belongs in no edge.
    { name: "stress", input: "", output: "", ratePerSecond: rate(0) },
  ],
  processes: [
    {
      name: "water recycler",
      modifiers: ["_WaterRecycler"],
      inputs: { ElectricCharge: rate(0.0446), WasteWater: rate(0.00000619) },
      outputs: { Water: rate(0.000005262975), Ammonia: rate(0.0000361969) },
      dumpValves: ["Water", "Ammonia"],
    },
    {
      name: "water electrolysis",
      modifiers: ["_WaterElectrolysis"],
      inputs: { ElectricCharge: rate(2.402669494), Water: rate(0.0008043014) },
      outputs: { Hydrogen: rate(1.0011122892), Oxygen: rate(0.5065967413) },
    },
    {
      name: "fuel cell",
      modifiers: ["_FuelCell"],
      inputs: { Hydrogen: rate(1.0011122892), Oxygen: rate(0.5065967413) },
      outputs: { Water: rate(0.0008043014), ElectricCharge: rate(2.402669494) },
    },
    {
      name: "zero gravity shower",
      modifiers: ["_Shower"],
      inputs: { ElectricCharge: rate(0.014049975), Water: rate(0.0000839507) },
      outputs: { WasteWater: rate(0.0000839507) },
    },
  ],
} as unknown as KerbalismProfile;

/** A recycler on one part, a shower on another. Capacities are invented. */
const FITTED = {
  processes: [
    {
      resource: "_WaterRecycler",
      title: "Water recycler",
      capacity: 30,
      running: true,
      broken: false,
      flightId: 101,
    },
    {
      resource: "_Shower",
      title: "Zero-g shower",
      capacity: 1,
      running: true,
      broken: false,
      flightId: 202,
    },
    // Fitted but switched off: contributes nothing to the sum.
    {
      resource: "_FuelCell",
      title: "Fuel cell",
      capacity: 1,
      running: false,
      broken: false,
      flightId: 303,
    },
  ],
} as unknown as KerbalismLifeSupport;

const CREW = 3;

describe("resourceFacts", () => {
  it("reads pooling and supply status off the profile, never a list of ours", () => {
    const facts = resourceFacts(PROFILE);
    expect(facts.get("Water")?.pooled).toBe(true);
    expect(facts.get("ElectricCharge")?.pooled).toBe(true);
    expect(facts.get("Water")?.isSupply).toBe(true);
    // Touched by processes but not declared a Supply: carried, not life support.
    expect(facts.get("Ammonia")?.isSupply).toBe(false);
  });

  it("leaves pooling UNKNOWN rather than guessing when flowMode is missing", () => {
    // undefined must not be read as "not pooled": the honest render is "share
    // of a vessel-wide pool, mode unknown", and a per-part meter drawn on a
    // false `false` would be a confident lie.
    expect(resourceFacts(PROFILE).get("CarbonDioxide")?.pooled).toBeUndefined();
  });
});

describe("buildLedger", () => {
  const ledger = buildLedger({
    resource: "Water",
    profile: PROFILE,
    lifeSupport: FITTED,
    crew: CREW,
  });

  it("decomposes the net rate into named, located terms", () => {
    expect(ledger.terms.map((t) => t.name)).toEqual([
      "water recycler", // +0.000005262975 * 30
      "zero gravity shower", // -0.0000839507 * 1
      "drinking", // -(0.03359375 / 5400) * 3
    ]);
    // The recycler's row says WHERE, which is the whole reason flightId is on
    // the wire: "the recycler" is useless on a station carrying three.
    expect(ledger.terms[0].flightId).toBe(101);
    expect(ledger.terms[0].ratePerSecond).toBeCloseTo(0.000005262975 * 30, 12);
    // A crew rule scales by head count, a process by part capacity.
    expect(ledger.terms[2].scale).toBe(CREW);
  });

  it("sums exactly to its own derived net", () => {
    const sum = ledger.terms.reduce((n, t) => n + t.ratePerSecond, 0);
    expect(ledger.derivedNet).toBeCloseTo(sum, 15);
  });

  it("skips a fitted-but-idle converter", () => {
    // The fuel cell produces Water and is aboard, but it is switched off, so it
    // is not part of the sum. A widget that wants to SHOW it as idle reads the
    // process list; the ledger is what is actually happening.
    expect(ledger.terms.some((t) => t.name === "fuel cell")).toBe(false);
  });

  it("reports the residual against Kerbalism's own rate rather than hiding it", () => {
    // The modifier product (pressure, lamps, radiation) scales each process at
    // runtime and is not on the wire, so the terms are NOMINAL. The gap between
    // their sum and Kerbalism's own scalar is exactly how wrong they are, which
    // is a usable self-check instead of a silent error.
    const withReported = buildLedger({
      resource: "Water",
      profile: PROFILE,
      lifeSupport: {
        ...FITTED,
        rates: { Water: rate(-0.00002) },
      } as KerbalismLifeSupport,
      crew: CREW,
    });
    expect(withReported.reportedNet).toBeCloseTo(-0.00002, 12);
    expect(withReported.residual).toBeCloseTo(
      -0.00002 - withReported.derivedNet,
      12,
    );
  });

  it("has no residual to report when Kerbalism reported no rate", () => {
    expect(ledger.reportedNet).toBeUndefined();
    expect(ledger.residual).toBeUndefined();
  });
});

describe("closedLoops", () => {
  it("finds a loop that closes through more than one hop", () => {
    // Water -> electrolysis -> Hydrogen -> fuel cell -> Water. A detector that
    // only sees a converter handing its own input straight back misses this
    // entirely, which is the bug that made the first pass report one loop.
    const loops = closedLoops(PROFILE);
    expect(loops.length).toBeGreaterThan(0);
    expect(loops[0]).toEqual(
      expect.arrayContaining(["ElectricCharge", "Hydrogen", "Oxygen", "Water"]),
    );
  });

  it("keeps a pure accumulator rule out of the graph", () => {
    // `stress` moves no resource; an edge for it would be a lie.
    expect(closedLoops(PROFILE).flat()).not.toContain("stress");
  });
});

describe("diagnose", () => {
  // EC short, and the fuel cell that would make EC needs Hydrogen, which the
  // electrolyser would make from Water and EC. Water is short too.
  const RUNNING = {
    rates: {
      Water: rate(-0.000054),
      ElectricCharge: rate(-0.1856),
      Hydrogen: rate(-0.03),
    },
    processes: [
      {
        resource: "_WaterRecycler",
        title: "Water recycler",
        capacity: 30,
        running: true,
        broken: false,
        flightId: 101,
      },
      {
        resource: "_FuelCell",
        title: "Fuel cell",
        capacity: 40,
        running: true,
        broken: false,
        flightId: 303,
      },
      {
        resource: "_WaterElectrolysis",
        title: "Electrolysis",
        capacity: 1,
        running: true,
        broken: false,
        flightId: 404,
      },
    ],
  } as unknown as KerbalismLifeSupport;
  const STORED = {
    Water: 258,
    ElectricCharge: 215,
    Hydrogen: 0,
    WasteWater: 188,
  };

  const groups = diagnose({
    profile: PROFILE,
    lifeSupport: RUNNING,
    stored: STORED,
  });

  it("condenses mutually-blocking resources into ONE finding", () => {
    // Reporting Water, EC and Hydrogen separately would send an operator
    // chasing three symptoms of one problem.
    const cyclic = groups.find((g) => g.cycle);
    expect(cyclic).toBeDefined();
    expect(cyclic?.resources).toEqual(
      expect.arrayContaining(["ElectricCharge", "Hydrogen", "Water"]),
    );
  });

  it("puts root causes first", () => {
    expect(groups[0].role).toBe("root");
  });

  it("carries each member's signed rate so the finding can be read on its own", () => {
    const cyclic = groups.find((g) => g.cycle);
    expect(cyclic?.net.ElectricCharge).toBeCloseTo(-0.1856, 6);
  });

  it("ignores a producer too small to cover the gap", () => {
    // With the fuel cell shrunk to a rounding error it can no longer implicate
    // Hydrogen for Water's shortfall, so Water stops being tangled up in the
    // cycle. Without this filter every deficit blames every input and the root
    // cause falls out as whichever resource sorts last.
    const tiny = {
      ...RUNNING,
      processes: (RUNNING.processes ?? []).map((p) =>
        p.resource === "_FuelCell" ? { ...p, capacity: 0.0001 } : p,
      ),
    } as KerbalismLifeSupport;
    const cyclic = diagnose({
      profile: PROFILE,
      lifeSupport: tiny,
      stored: STORED,
    }).find((g) => g.cycle);
    expect(cyclic?.resources ?? []).not.toContain("Water");
  });

  it("says nothing when nothing is short", () => {
    expect(
      diagnose({
        profile: PROFILE,
        lifeSupport: { rates: { Water: rate(0.5) } } as KerbalismLifeSupport,
        stored: STORED,
      }),
    ).toEqual([]);
  });
});

describe("timeToEmptySeconds", () => {
  const ls = {
    rates: { Water: rate(-0.0001), Oxygen: rate(0.2) },
  } as unknown as KerbalismLifeSupport;

  it("divides what is left by what is leaving", () => {
    expect(timeToEmptySeconds("Water", ls, { Water: 10 })).toBeCloseTo(
      100_000,
      6,
    );
  });

  it("is null while a resource is flat or filling", () => {
    expect(timeToEmptySeconds("Oxygen", ls, { Oxygen: 10 })).toBeNull();
    // Absent is not zero: Kerbalism reported no rate, so there is no countdown
    // to give, which is different from "it will never run out".
    expect(timeToEmptySeconds("Ammonia", ls, { Ammonia: 10 })).toBeNull();
  });
});
