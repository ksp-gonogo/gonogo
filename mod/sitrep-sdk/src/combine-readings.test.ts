import { describe, expect, it } from "vitest";
import { combineReadings } from "./combine-readings";
import type { Reading, StaleGrade } from "./reading";
import { value } from "./unit-system/value";

/**
 * The combinator's currency rule, one test per clause of it.
 *
 * The clauses are the operator's ruling on #257 (comment 418 on #296), and two
 * of them exist BECAUSE the obvious reading was unavailable: `StaleGrade` has
 * no severity order and the three non-value states have no precedence, so the
 * rules are positional and tied to the instant rather than ranked. Each is
 * asserted here so a later "tidy-up" that invents a ranking fails.
 */

const at = (ut: number) => value("ut", ut);

function observed<V>(v: V, ut: number): Reading<V> {
  return {
    state: "observed",
    value: v,
    atUt: at(ut),
    reckoning: { status: "none" },
  };
}

function stale<V>(v: V, ut: number, grade: StaleGrade): Reading<V> {
  return {
    state: "stale",
    value: v,
    asOfUt: at(ut),
    grade,
    reckoning: { status: "none" },
  };
}

describe("combineReadings currency", () => {
  it("is observed at the OLDEST atUt when every input is observed", () => {
    const r = combineReadings(
      [observed(3, 100), observed(4, 90)],
      (a, b) => a + b,
    );
    expect(r.state).toBe("observed");
    expect(r.value).toBe(7);
    expect(r.atUt?.magnitude).toBe(90);
  });

  it("is stale as of the oldest instant when any input is stale", () => {
    const r = combineReadings(
      [observed(3, 100), stale(4, 60, "held-stale")],
      (a, b) => a + b,
    );
    expect(r.state).toBe("stale");
    expect(r.value).toBe(7);
    expect(r.asOfUt?.magnitude).toBe(60);
    expect(r.atUt).toBeUndefined();
  });

  /**
   * The grade travels with the instant rather than being ranked. `recorded` is
   * an exact value taken out of contact and `disconnected` is a dead transport;
   * nothing can say which is "worse", so the one that explains the instant the
   * result is stamped at is the one reported.
   */
  it("takes the grade of the input that contributed the oldest instant", () => {
    const r = combineReadings(
      [stale(1, 80, "disconnected"), stale(2, 40, "recorded")],
      (a, b) => a + b,
    );
    expect(r.asOfUt?.magnitude).toBe(40);
    expect(r.grade).toBe("recorded");
  });

  it("omits the grade when inputs tie on the oldest instant and disagree", () => {
    const r = combineReadings(
      [stale(1, 40, "disconnected"), stale(2, 40, "recorded")],
      (a, b) => a + b,
    );
    expect(r.asOfUt?.magnitude).toBe(40);
    expect(r.grade).toBeUndefined();
  });

  it("keeps the grade when tied inputs agree on it", () => {
    const r = combineReadings(
      [stale(1, 40, "recorded"), stale(2, 40, "recorded")],
      (a, b) => a + b,
    );
    expect(r.grade).toBe("recorded");
  });
});

describe("combineReadings on an input with no value", () => {
  const absent: Reading<number> = {
    state: "absent",
    reckoning: { status: "none" },
  };
  const pending: Reading<number> = {
    state: "pending",
    reckoning: { status: "none" },
  };

  it("takes that state and carries no value", () => {
    const r = combineReadings([observed(3, 100), absent], (a, b) => a + b);
    expect(r.state).toBe("absent");
    expect(r.value).toBeUndefined();
  });

  /**
   * Positional because there IS no meaningful ranking of absent, pending and
   * unowned. A rule that picked one as "worse" would be inventing a severity
   * the model does not have.
   */
  it("takes the FIRST such input in argument order", () => {
    expect(combineReadings([pending, absent], (a, b) => a + b).state).toBe(
      "pending",
    );
    expect(combineReadings([absent, pending], (a, b) => a + b).state).toBe(
      "absent",
    );
  });

  it("does not run the computation at all", () => {
    let ran = false;
    combineReadings([observed(3, 100), absent], (a, b) => {
      ran = true;
      return a + b;
    });
    expect(ran).toBe(false);
  });

  /**
   * The shape the states alone get wrong, and the one a field reading hands
   * over every day: `career.status.economy.subsidyPerDay` on a career that
   * reports an upkeep and no subsidy is `observed` (the topic WAS observed)
   * with no value (the field was not in it). Trusting `state` here handed
   * `compute` an `undefined` and `CareerEconomy` threw on `.minus`.
   */
  it("treats an observed input that carries no value as one with none", () => {
    const fieldNotCarried: Reading<number> = {
      state: "observed",
      atUt: at(100),
      reckoning: { status: "none" },
    };
    let ran = false;
    const r = combineReadings([observed(3, 100), fieldNotCarried], (a, b) => {
      ran = true;
      return a + b;
    });
    expect(ran).toBe(false);
    expect(r.state).toBe("observed");
    expect(r.value).toBeUndefined();
  });

  it("does the same for a stale input that carries no value", () => {
    const heldNotCarried: Reading<number> = {
      state: "stale",
      asOfUt: at(90),
      grade: "disconnected",
      reckoning: { status: "none" },
    };
    const r = combineReadings(
      [observed(3, 100), heldNotCarried],
      (a, b) => a + b,
    );
    expect(r.state).toBe("stale");
    expect(r.value).toBeUndefined();
  });

  /**
   * The model half of the same fault. A field projection covered by a model can
   * still find nothing at its path: `fieldReckoning` writes
   * `walkField(reckoning.value, path)` into a slot typed `unknown`, so the
   * `undefined` is reachable at runtime while `ReckoningAvailable.modelled`
   * declares a value. Written here over `number | undefined`, which is the
   * shape that says so without a cast.
   */
  it("carries no model when an available reckoning modelled nothing", () => {
    const withModel: Reading<number> = {
      state: "observed",
      value: 3,
      atUt: at(100),
      reckoning: {
        status: "available",
        modelled: 3,
        basis: "rate-integration",
      },
    };
    const modelledNothing: Reading<number | undefined> = {
      state: "observed",
      value: 4,
      atUt: at(100),
      reckoning: {
        status: "available",
        modelled: undefined,
        basis: "rate-integration",
      },
    };
    const r = combineReadings(
      [withModel, modelledNothing],
      (a, b) => a + (b ?? 0),
    );
    expect(r.value).toBe(7);
    expect(r.reckoning.status).toBe("none");
  });

  /**
   * `null`, not `undefined`, because that is how the wire spells an absent
   * field: `Sitrep.Contract` nulls one whenever the raw value is absent or
   * non-finite. `vessel.target.relativePosition` is null off a target with no
   * relative geometry, and a guard that only tested `undefined` let that
   * through to `compute`, where `bare()` threw on `.x`.
   */
  it("treats a null value as no value, since null is how absence arrives", () => {
    const nulled: Reading<{ x: number } | null> = {
      state: "observed",
      value: null,
      atUt: at(100),
      reckoning: { status: "none" },
    };
    let ran = false;
    const r = combineReadings([nulled], (v) => {
      ran = true;
      return v?.x;
    });
    expect(ran).toBe(false);
    expect(r.state).toBe("observed");
    expect(r.value).toBeUndefined();
  });
});

describe("combineReadings when the arithmetic has no answer", () => {
  /**
   * A domain limit, not an absence. The inputs arrived, so the state and the
   * instant they earned are kept and only the value is missing: reporting
   * `absent` here would be a claim about the wire rather than about the
   * mathematics. `radialSpeed` at zero separation is the real case.
   */
  it("keeps the state and the instant, and carries no value", () => {
    const r = combineReadings([observed(3, 100), observed(0, 90)], (a, b) =>
      b === 0 ? undefined : a / b,
    );
    expect(r.state).toBe("observed");
    expect(r.value).toBeUndefined();
    expect(r.atUt?.magnitude).toBe(90);
  });

  it("is stale with no value where an input was stale", () => {
    const r = combineReadings(
      [observed(3, 100), stale(0, 60, "held-stale")],
      (a, b) => (b === 0 ? undefined : a / b),
    );
    expect(r.state).toBe("stale");
    expect(r.value).toBeUndefined();
    expect(r.asOfUt?.magnitude).toBe(60);
  });

  /**
   * The model half. `ReckoningAvailable.modelled` is a REQUIRED value, so a
   * combination with no answer for the modelled figures has no model rather
   * than an available one carrying nothing.
   */
  it("offers no model when the modelled figures have no answer either", () => {
    const modelled = (v: number, m: number): Reading<number> => ({
      state: "observed",
      value: v,
      atUt: at(100),
      reckoning: {
        status: "available",
        modelled: m,
        basis: "rate-integration",
      },
    });
    const r = combineReadings([modelled(3, 5), modelled(2, 0)], (a, b) =>
      b === 0 ? undefined : a / b,
    );
    expect(r.value).toBe(1.5);
    expect(r.reckoning.status).toBe("none");
  });

  it("still offers a model where the modelled figures DO have one", () => {
    const modelled = (v: number, m: number): Reading<number> => ({
      state: "observed",
      value: v,
      atUt: at(100),
      reckoning: {
        status: "available",
        modelled: m,
        basis: "rate-integration",
      },
    });
    const r = combineReadings([modelled(3, 6), modelled(0, 2)], (a, b) =>
      b === 0 ? undefined : a / b,
    );
    // No observation (divided by a zero) and a model that divided by two.
    expect(r.value).toBeUndefined();
    expect(r.reckoning.status).toBe("available");
    if (r.reckoning.status !== "available") throw new Error("unreachable");
    expect(r.reckoning.modelled).toBe(3);
  });
});

describe("combineReadings model", () => {
  const modelled = (v: number, m: number, ut: number): Reading<number> => ({
    state: "observed",
    value: v,
    atUt: at(ut),
    reckoning: {
      status: "available",
      modelled: m,
      basis: "rate-integration",
    },
  });

  it("is available with basis combination when every input has one", () => {
    const r = combineReadings(
      [modelled(3, 5, 100), modelled(4, 6, 100)],
      (a, b) => a + b,
    );
    expect(r.reckoning.status).toBe("available");
    if (r.reckoning.status !== "available") throw new Error("unreachable");
    expect(r.reckoning.modelled).toBe(11);
    expect(r.reckoning.basis).toBe("combination");
  });

  /** A combination that deserves a band deserves a model, per #215. */
  it("never carries a band of its own", () => {
    const r = combineReadings(
      [modelled(3, 5, 100), modelled(4, 6, 100)],
      (a, b) => a + b,
    );
    if (r.reckoning.status !== "available") throw new Error("unreachable");
    expect(r.reckoning.band).toBeUndefined();
  });

  it("is none when any input has no model", () => {
    const r = combineReadings(
      [modelled(3, 5, 100), observed(4, 100)],
      (a, b) => a + b,
    );
    expect(r.reckoning.status).toBe("none");
  });

  it("declines and NAMES the input that declined", () => {
    const refused: Reading<number> = {
      state: "observed",
      value: 4,
      atUt: at(100),
      reckoning: {
        status: "declined",
        declined: { reason: "input-absent", input: "@vessel.orbit" },
      },
    };
    const r = combineReadings([modelled(3, 5, 100), refused], (a, b) => a + b);
    expect(r.reckoning.status).toBe("declined");
    if (r.reckoning.status !== "declined") throw new Error("unreachable");
    expect(r.reckoning.declined.input).toBe("@vessel.orbit");
  });

  /**
   * The state axis and the model axis are independent, which `Reading` already
   * documents. A live value whose model declined is still live.
   */
  it("keeps state and model independent", () => {
    const refused: Reading<number> = {
      state: "observed",
      value: 4,
      atUt: at(100),
      reckoning: {
        status: "declined",
        declined: { reason: "beyond-horizon" },
      },
    };
    const r = combineReadings([observed(3, 100), refused], (a, b) => a + b);
    expect(r.state).toBe("observed");
    expect(r.value).toBe(7);
    expect(r.reckoning.status).toBe("declined");
  });
});
