import { describe, expect, it } from "vitest";
import {
  type BurnAxis,
  burnAxis,
  burnDurationSeconds,
  burnInstantRows,
} from "./burnWindow";

describe("burnInstantRows", () => {
  it("always returns all three, in the order they occur", () => {
    const rows = burnInstantRows({ ut: 1000, ignitionUt: 980, cutoffUt: 1025 });

    expect(rows.map((r) => r.kind)).toEqual([
      "ignition",
      "reference",
      "cutoff",
    ]);
    expect(rows.map((r) => r.atUt)).toEqual([980, 1000, 1025]);
  });

  it("keeps the outer two present-but-absent for an impulsive plan, never collapsed onto the reference", () => {
    const rows = burnInstantRows({ ut: 1000 });

    expect(rows).toHaveLength(3);
    expect(rows[0].atUt).toBeNull();
    expect(rows[2].atUt).toBeNull();
    expect(rows[1].atUt).toBe(1000);
    // Absence says why, rather than the row vanishing or showing the reference.
    expect(rows[0].basis).toMatch(/no burn-time model/i);
    expect(rows[2].basis).toMatch(/no burn-time model/i);
  });

  it("gives every row its own question so none reads as a restatement", () => {
    const questions = burnInstantRows({ ut: 1000 }).map((r) => r.question);

    expect(new Set(questions).size).toBe(3);
  });

  // The reference is the half-delta-v instant, not the midpoint, so the window is asymmetric.
  it("carries an asymmetric window as given rather than re-centring it", () => {
    const rows = burnInstantRows({ ut: 1000, ignitionUt: 976, cutoffUt: 1021 });

    expect(rows[0].atUt).toBe(976);
    expect(rows[2].atUt).toBe(1021);
    expect(1000 - 976).not.toBe(1021 - 1000);
  });
});

describe("burnDurationSeconds", () => {
  it("is the span between the two instants", () => {
    expect(
      burnDurationSeconds({ ut: 1000, ignitionUt: 980, cutoffUt: 1025 }),
    ).toBe(45);
  });

  it("is null when either instant is missing, never zero", () => {
    expect(burnDurationSeconds({ ut: 1000 })).toBeNull();
    expect(burnDurationSeconds({ ut: 1000, ignitionUt: 980 })).toBeNull();
    expect(burnDurationSeconds({ ut: 1000, cutoffUt: 1025 })).toBeNull();
  });
});

describe("burnAxis", () => {
  // Every fixture here is a real burn, so a null axis is a failure, not the impulsive case.
  const mustAxis = (axis: BurnAxis | null): BurnAxis => {
    if (axis === null) throw new Error("burnAxis drew nothing for a real burn");
    return axis;
  };

  it("plots the three on one scale, ordered", () => {
    const axis = mustAxis(
      burnAxis(
        burnInstantRows({ ut: 1000, ignitionUt: 980, cutoffUt: 1025 }),
        970,
      ),
    );

    const fractions = axis.marks.map((m) => m.fraction);
    expect(fractions).toEqual([...fractions].sort((a, b) => a - b));
    expect(fractions[0]).toBe(0);
    expect(fractions[fractions.length - 1]).toBe(1);
  });

  it("does not let a distant clock compress the marks together", () => {
    const axis = mustAxis(
      burnAxis(
        burnInstantRows({ ut: 1000, ignitionUt: 976, cutoffUt: 1021 }),
        760,
      ),
    );

    const fractions = axis.marks.map((m) => m.fraction);
    expect(Math.max(...fractions) - Math.min(...fractions)).toBe(1);
  });

  it("reports a clock outside the burn as outside the axis", () => {
    const before = mustAxis(
      burnAxis(
        burnInstantRows({ ut: 1000, ignitionUt: 976, cutoffUt: 1021 }),
        760,
      ),
    );
    expect(before.nowFraction).toBeLessThan(0);

    const after = mustAxis(
      burnAxis(
        burnInstantRows({ ut: 1000, ignitionUt: 976, cutoffUt: 1021 }),
        2000,
      ),
    );
    expect(after.nowFraction).toBeGreaterThan(1);
  });

  it("draws nothing for an impulsive plan", () => {
    expect(burnAxis(burnInstantRows({ ut: 1000 }), 900)).toBeNull();
  });

  it("places a clock already inside the burn along the axis", () => {
    const axis = mustAxis(
      burnAxis(
        burnInstantRows({ ut: 1000, ignitionUt: 980, cutoffUt: 1025 }),
        990,
      ),
    );

    expect(axis.fromUt).toBe(980);
    expect(axis.nowFraction).toBeGreaterThan(0);
    expect(axis.nowFraction).toBeLessThan(1);
  });
});

// A burn window derives from a node and cannot exist without one; every node yields exactly one window.
describe("a burn window and its node are the same node", () => {
  interface NodeLike {
    UT: number;
    ignitionUt: number | null;
    cutoffUt: number | null;
  }

  const nodes: NodeLike[] = [
    { UT: 1000, ignitionUt: 976, cutoffUt: 1021 },
    { UT: 5000, ignitionUt: null, cutoffUt: null },
  ];

  it("yields exactly one window per node, duration or not", () => {
    const windows = nodes.map((n) =>
      burnInstantRows({
        ut: n.UT,
        ignitionUt: n.ignitionUt,
        cutoffUt: n.cutoffUt,
      }),
    );

    expect(windows).toHaveLength(nodes.length);
    // A window's reference instant is its node's UT, which ties the window to its node.
    expect(windows.map((w) => w[1].atUt)).toEqual(nodes.map((n) => n.UT));
  });

  it("has no window at all when there are no nodes", () => {
    expect([].map(() => burnInstantRows({ ut: 0 }))).toHaveLength(0);
  });
});

describe("burnInstantRows: the framing is the caller's", () => {
  const burn = { ut: 1000, ignitionUt: 980, cutoffUt: 1020 };

  it("uses the stock framing by default, so the single caller is unaffected", () => {
    const [ignition, reference] = burnInstantRows(burn);
    expect(ignition.basis).toBe("rocket equation");
    expect(reference.basis).toBe("planned");
  });

  it("takes a caller's whole table, not just its basis strings", () => {
    // An integrating planner needs its own words for both an instant's source and its absence.
    const integrated = {
      ignition: {
        label: "Ignition",
        question: "when do the engines light",
        basis: "integrated",
        absent: "not integrated yet",
        absentDetail: "The trajectory has not been integrated this far.",
      },
      reference: {
        label: "Burn",
        question: "when is the burn",
        basis: "integrated",
        absent: "no burn",
        absentDetail: "There is no burn to place.",
      },
      cutoff: {
        label: "Cutoff",
        question: "when do the engines stop",
        basis: "integrated",
        absent: "not integrated yet",
        absentDetail: "The trajectory has not been integrated this far.",
      },
    };
    const rows = burnInstantRows(burn, integrated);
    expect(rows.map((r) => r.basis)).toEqual([
      "integrated",
      "integrated",
      "integrated",
    ]);
    expect(rows[1].label).toBe("Burn");
  });

  it("takes the caller's absent wording too, which is where stock is named", () => {
    const noDuration = { ut: 1000 };
    const [ignition] = burnInstantRows(noDuration);
    expect(ignition.basis).toBe("no burn-time model");
    expect(ignition.detail).toContain("Stock");
  });
});
