import { value } from "@ksp-gonogo/sitrep-sdk";
import { describe, expect, it } from "vitest";
import type { FlightPlan } from "./plan";
import {
  type PlanLive,
  type PlanProgress,
  scorePlan,
  stepReached,
} from "./scoring";

const plan: FlightPlan = {
  id: "mun-east",
  name: "Mun landing, east",
  reserve: 0.1,
  steps: [
    { id: "s1", kind: "launch", inputs: { heading: 90 }, intents: [] },
    {
      id: "s2",
      kind: "reach-orbit",
      inputs: { body: "Kerbin", periapsis: 80_000 },
      needsDv: 3_400,
      script: { name: "ascent.ks", cpu: "main" },
      intents: [
        {
          group: 2,
          label: "Jettison fairing",
          trigger: {
            kind: "value",
            quantity: "altitude",
            op: ">=",
            value: 55_000,
          },
        },
        {
          group: 4,
          label: "Thermometer report",
          trigger: { kind: "time", at: 330 },
        },
      ],
    },
    {
      id: "s3",
      kind: "transfer",
      inputs: { to: "Mun" },
      needsDv: 860,
      intents: [],
    },
    {
      id: "s4",
      kind: "land",
      inputs: { on: "Mun" },
      needsDv: 890,
      intents: [
        {
          group: 1,
          label: "Extend landing legs",
          trigger: {
            kind: "value",
            quantity: "altitude",
            op: "<=",
            value: 2_000,
            body: "Mun",
          },
        },
      ],
    },
  ],
};

interface LiveNumbers {
  missionTime?: number;
  altitude?: number;
  apoapsis?: number;
  periapsis?: number;
  body?: string;
  landed?: boolean;
  dvLeft?: number;
  /** Defaults to `dvLeft`: the two agree out of the air. */
  dvVacuum?: number;
  firedAt?: Map<number, number>;
}

const BASE: LiveNumbers = {
  missionTime: 112,
  altitude: 41_600,
  apoapsis: 62_000,
  periapsis: -410_000,
  body: "Kerbin",
  landed: false,
  dvLeft: 3_920,
};

/** The live flight from plain SI numbers; a key given as `undefined` stays unknown. */
const live = (over: LiveNumbers = {}): PlanLive => {
  const n = { ...BASE, ...over };
  const m = (x: number | undefined) =>
    x === undefined ? undefined : value("m", x);
  return {
    missionTime:
      n.missionTime === undefined ? undefined : value("s", n.missionTime),
    altitude: m(n.altitude),
    apoapsis: m(n.apoapsis),
    periapsis: m(n.periapsis),
    body: n.body,
    landed: n.landed,
    dvLeft: n.dvLeft === undefined ? undefined : value("m/s", n.dvLeft),
    dvVacuum: (() => {
      const vac = "dvVacuum" in over ? over.dvVacuum : n.dvLeft;
      return vac === undefined ? undefined : value("m/s", vac);
    })(),
    firedAt: new Map(
      [...(n.firedAt ?? new Map())].map(([g, t]) => [g, value("s", t)]),
    ),
  };
};

const progressAt = (vacuumDvAtLaunch: number): PlanProgress => ({
  doneAt: new Map([["s1", value("s", 58)]]),
  vacuumDvAtLaunch: value("m/s", vacuumDvAtLaunch),
});
const progress = progressAt(5_620);

describe("scorePlan", () => {
  it("scores the remaining steps against the Δv left and holds the reserve", () => {
    const scored = scorePlan(plan, live(), progress);
    expect(scored.current).toBe(1);
    expect(scored.steps.map((s) => s.status.kind)).toEqual([
      "done",
      "current",
      "met",
      "marginal",
    ]);
    expect(scored.need?.equals(1_700 + 860 + 890)).toBe(true);
    expect(scored.margin?.equals(470)).toBe(true);
    expect(scored.reserve.equals(515)).toBe(true);
    expect(scored.state).toEqual({ kind: "marginal" });
  });

  it("names the first step the Δv left cannot reach", () => {
    const scored = scorePlan(
      plan,
      live({ dvLeft: 2_100 }),
      progressAt(2_100 + 1_700),
    );
    const s3 = scored.steps[2]?.status;
    expect(s3?.kind === "short" && s3.by.equals(460)).toBe(true);
    const s4 = scored.steps[3]?.status;
    expect(s4?.kind === "short" && s4.by.equals(890)).toBe(true);
    expect(scored.state).toEqual({ kind: "fails-at", step: 3 });
  });

  it("flags the step whose intent passed its trigger without firing", () => {
    const scored = scorePlan(
      plan,
      live({ altitude: 58_300, dvLeft: 5_000 }),
      progressAt(5_620),
    );
    expect(scored.steps[1]?.flagged).toBe(true);
    expect(scored.steps[1]?.intents[0]?.status).toEqual({ kind: "overdue" });
    expect(scored.state).toEqual({ kind: "off-plan" });
  });

  it("reads a fired intent from the time its group engaged", () => {
    const scored = scorePlan(
      plan,
      live({ altitude: 58_300, firedAt: new Map([[2, 132]]) }),
      progress,
    );
    const fired = scored.steps[1]?.intents[0]?.status;
    expect(fired?.kind === "fired" && fired.at.equals(132)).toBe(true);
    expect(scored.steps[1]?.flagged).toBe(false);
  });

  it("does not flag a later step for an intent it has not reached", () => {
    const scored = scorePlan(
      plan,
      live({ altitude: 1_000, body: "Mun" }),
      progress,
    );
    expect(scored.steps[3]?.flagged).toBe(false);
  });

  it("marks a step likely to fail when under half the runs met it", () => {
    const scored = scorePlan(
      plan,
      live({ dvLeft: 5_620 }),
      progress,
      new Map([["s3", { met: 3, of: 9 }]]),
    );
    expect(scored.steps[2]?.status).toEqual({
      kind: "likely-to-fail",
      met: 3,
      of: 9,
    });
    expect(scored.state).toEqual({ kind: "fails-at", step: 3 });
  });

  /*
   * A Kerbal X climbing, as the Deck read it off the wire: 4458 m/s at sea
   * level and 6762 in vacuum on the pad, then at 10 km 6061 and 6459, at 32 km
   * 5120 and 5127. The Δv at the craft's air pressure rises through the climb,
   * so spent has to come from the fall in vacuum Δv.
   */
  describe("in flight, through the climb", () => {
    const climbing = progressAt(6_762);

    it("subtracts the vacuum Δv spent by 10 km from the current step", () => {
      const scored = scorePlan(
        plan,
        live({ dvLeft: 6_061, dvVacuum: 6_459 }),
        climbing,
      );
      expect(scored.need?.equals(3_400 - 303 + 860 + 890)).toBe(true);
      expect(scored.margin?.equals(6_061 - 4_847)).toBe(true);
      expect(scored.state.kind).not.toBe("fails-at");
    });

    it("leaves a margin at 32 km, not a failure at step 4", () => {
      const scored = scorePlan(
        plan,
        live({ dvLeft: 5_120, dvVacuum: 5_127 }),
        climbing,
      );
      expect(scored.need?.equals(3_400 - 1_635 + 860 + 890)).toBe(true);
      expect(scored.margin?.equals(1_605)).toBe(true);
      expect(scored.steps[3]?.status.kind).toBe("met");
      expect(scored.state).toEqual({ kind: "on-plan" });
    });

    it("takes the step's whole need without a vacuum reading", () => {
      const scored = scorePlan(
        plan,
        live({ dvLeft: 5_120, dvVacuum: undefined }),
        climbing,
      );
      expect(scored.need?.equals(3_400 + 860 + 890)).toBe(true);
    });
  });

  it("leaves Δv figures unknown while the Δv left is unknown", () => {
    const scored = scorePlan(plan, live({ dvLeft: undefined }), progress);
    expect(scored.need).toBeUndefined();
    expect(scored.margin).toBeUndefined();
    expect(scored.steps[2]?.status.kind).toBe("unscored");
  });
});

describe("stepReached", () => {
  it("reaches orbit at 95% of the target periapsis over the named body", () => {
    const step = plan.steps[1];
    if (!step) throw new Error("fixture");
    expect(stepReached(step, live({ periapsis: 76_000 }))).toBe(true);
    expect(stepReached(step, live({ periapsis: 75_000 }))).toBe(false);
    expect(stepReached(step, live({ periapsis: 80_000, body: "Mun" }))).toBe(
      false,
    );
  });

  it("lands only when landed or splashed on the named body", () => {
    const step = plan.steps[3];
    if (!step) throw new Error("fixture");
    expect(stepReached(step, live({ body: "Mun", landed: true }))).toBe(true);
    expect(stepReached(step, live({ body: "Kerbin", landed: true }))).toBe(
      false,
    );
  });
});
