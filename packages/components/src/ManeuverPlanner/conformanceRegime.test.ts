import { describe, expect, it } from "vitest";
import {
  conformanceRegime,
  devianceIsAttributable,
  finiteBurnResidual,
  RESIDUAL_ATTRIBUTABLE_LIMIT,
} from "./conformanceRegime";

const burn = { ut: 1000, ignitionUt: 976, cutoffUt: 1021 };

describe("conformanceRegime", () => {
  // The whole reason the regime exists: before ignition the gap is at its
  // LARGEST and nothing is wrong. Calling that deviance would make the plot's
  // worst-looking state the correct one.
  it("calls the gap the intended change before ignition", () => {
    expect(conformanceRegime(burn, 900)).toBe("intended-change");
  });

  it("says in-progress while the engines are running", () => {
    expect(conformanceRegime(burn, 1000)).toBe("in-progress");
    expect(conformanceRegime(burn, 976)).toBe("in-progress");
  });

  it("only calls it deviance from cutoff onwards", () => {
    expect(conformanceRegime(burn, 1021)).toBe("deviance");
    expect(conformanceRegime(burn, 5000)).toBe("deviance");
  });

  // Without instants nothing establishes that the burn was flown, so the plot
  // may never call the gap deviance however late the clock is.
  it("never reaches deviance without a burn-duration model", () => {
    const noModel = { ut: 1000 };
    expect(conformanceRegime(noModel, 900)).toBe("intended-change");
    expect(conformanceRegime(noModel, 5000)).toBe("unknown");
    expect(conformanceRegime(noModel, 5000)).not.toBe("deviance");
  });

  it("is unknown without a clock", () => {
    expect(conformanceRegime(burn, null)).toBe("unknown");
    expect(conformanceRegime(burn, Number.NaN)).toBe("unknown");
  });
});

describe("finiteBurnResidual", () => {
  // The measured table, which is the argument for computing this per burn
  // rather than writing one caveat: no single sentence is true at both ends.
  it("is negligible for a short burn and dominant for a long one", () => {
    expect(finiteBurnResidual(45, 3383)).toBeCloseTo(0.0003, 4);
    expect(finiteBurnResidual(0.25, 1)).toBeCloseTo(0.0997, 3);
    expect(finiteBurnResidual(0.5, 1)).toBeCloseTo(0.3634, 3);
  });

  it("saturates rather than going negative past a full orbit", () => {
    expect(finiteBurnResidual(2, 1)).toBe(1);
  });

  it("is null when nothing models a duration, which is not zero", () => {
    expect(finiteBurnResidual(null, 3383)).toBeNull();
    expect(finiteBurnResidual(45, null)).toBeNull();
    expect(finiteBurnResidual(0, 3383)).toBeNull();
  });
});

describe("devianceIsAttributable", () => {
  it("attributes the gap while the residual is under the limit", () => {
    expect(devianceIsAttributable(finiteBurnResidual(45, 3383))).toBe(true);
  });

  // At T/P = 0.25 the residual is ~10%: the same size as any flying error the
  // operator could see, so the plot must stop calling the gap theirs.
  it("refuses to attribute a long low-thrust burn", () => {
    expect(devianceIsAttributable(finiteBurnResidual(0.25, 1))).toBe(false);
  });

  // Unknown is not zero. A craft with no duration model has an unattributable
  // gap for a different reason, and must not read as a clean one.
  it("does not treat an unknown residual as a small one", () => {
    expect(devianceIsAttributable(null)).toBe(false);
  });

  it("is pinned to the documented 1% limit", () => {
    expect(RESIDUAL_ATTRIBUTABLE_LIMIT).toBe(0.01);
  });
});

describe("conformanceRegime: past cutoff is not the same fact as flown", () => {
  const burn = { ut: 1000, ignitionUt: 980, cutoffUt: 1020 };

  it("reads MISSED when the window has passed and nothing was delivered", () => {
    // The contradiction a render surfaced: this burn read as "flown, the gap is
    // the deviance" while the row beside it said "not started, 0 of 300 m/s".
    expect(conformanceRegime(burn, 1060, 0, 300)).toBe("missed");
  });

  it("still reads DEVIANCE when something was actually delivered", () => {
    expect(conformanceRegime(burn, 1060, 295, 300)).toBe("deviance");
  });

  it("reads DEVIANCE when delivery is UNKNOWN, rather than inventing a miss", () => {
    // null is not zero. With no observation behind it, calling the burn missed
    // would be asserting something nothing measured.
    expect(conformanceRegime(burn, 1060, null, 300)).toBe("deviance");
    expect(conformanceRegime(burn, 1060)).toBe("deviance");
  });

  it("counts a trace delivery as nothing, since the figure is differenced", () => {
    expect(conformanceRegime(burn, 1060, 0.2, 300)).toBe("missed");
    expect(conformanceRegime(burn, 1060, 5, 300)).toBe("deviance");
  });

  it("does not let delivery override the regimes before cutoff", () => {
    // A burn not yet lit has delivered nothing, and that must not read as
    // missed while its window is still open.
    expect(conformanceRegime(burn, 900, 0, 300)).toBe("intended-change");
    expect(conformanceRegime(burn, 1000, 0, 300)).toBe("in-progress");
  });
});
