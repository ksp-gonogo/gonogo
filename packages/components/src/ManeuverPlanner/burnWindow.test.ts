import { describe, expect, it } from "vitest";
import { burnAxis, burnDurationSeconds, burnInstantRows } from "./burnWindow";

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

  // The whole point of three rows. Two rows would read as a complete answer to
  // a different question, and one countdown is true of whichever instant it
  // came from and wrong about the other two.
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

  // Ignition is NOT the reference minus half the duration: the reference is the
  // half-delta-v instant and the craft is heavier before it, so the mod-side
  // rocket-equation timing puts it asymmetrically. The client must carry what
  // it is told rather than re-deriving a midpoint.
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
  it("plots the three on one scale, ordered", () => {
    const axis = burnAxis(
      burnInstantRows({ ut: 1000, ignitionUt: 980, cutoffUt: 1025 }),
      970,
    );

    expect(axis).not.toBeNull();
    const fractions = axis!.marks.map((m) => m.fraction);
    expect(fractions).toEqual([...fractions].sort((a, b) => a - b));
    // The span is the burn, so the outer two marks pin the ends and the whole
    // width is spent on the thing being compared.
    expect(fractions[0]).toBe(0);
    expect(fractions[fractions.length - 1]).toBe(1);
  });

  // The failure a render caught: including `now` in the span put a 45s burn
  // four minutes out inside the last tenth of the axis, so the picture whose
  // job is to show ordering showed one blob.
  it("does not let a distant clock compress the marks together", () => {
    const axis = burnAxis(
      burnInstantRows({ ut: 1000, ignitionUt: 976, cutoffUt: 1021 }),
      760,
    );

    const fractions = axis!.marks.map((m) => m.fraction);
    expect(Math.max(...fractions) - Math.min(...fractions)).toBe(1);
  });

  // Out of range rather than clamped, so a renderer can omit it. Clamping would
  // draw the clock at ignition while the burn is minutes away.
  it("reports a clock outside the burn as outside the axis", () => {
    const before = burnAxis(
      burnInstantRows({ ut: 1000, ignitionUt: 976, cutoffUt: 1021 }),
      760,
    );
    expect(before!.nowFraction).toBeLessThan(0);

    const after = burnAxis(
      burnInstantRows({ ut: 1000, ignitionUt: 976, cutoffUt: 1021 }),
      2000,
    );
    expect(after!.nowFraction).toBeGreaterThan(1);
  });

  // A single mark shows no ordering, so an axis drawn for it is decoration
  // dressed as information. The impulsive case must draw nothing.
  it("draws nothing for an impulsive plan", () => {
    expect(burnAxis(burnInstantRows({ ut: 1000 }), 900)).toBeNull();
  });

  it("places a clock already inside the burn along the axis", () => {
    const axis = burnAxis(
      burnInstantRows({ ut: 1000, ignitionUt: 980, cutoffUt: 1025 }),
      990,
    );

    expect(axis!.fromUt).toBe(980);
    expect(axis!.nowFraction).toBeGreaterThan(0);
    expect(axis!.nowFraction).toBeLessThan(1);
  });
});

// ---------------------------------------------------------------------------
// The invariant that a fixture broke, expressed against the SHAPE rather than
// checked after the fact.
//
// A render once showed a burn window for a node the list beside it said did not
// exist. The cause was two reads of one truth: the window came off
// `vessel.maneuver` and the list off the derived legacy channel, and a fixture
// that fed only the first made them disagree. The fix moved the instants onto
// the parsed node, so both surfaces now iterate the same array.
//
// These pin the property that makes that fix load-bearing: a burn window is
// derived from a node and cannot exist without one, and every node yields
// exactly one window whether or not it has a duration. If a later change
// reintroduces a second source, the first of these stops compiling and the
// second starts failing.
// ---------------------------------------------------------------------------
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
    // Every window's reference instant IS its node's UT, which is what makes a
    // window traceable to the node it describes.
    expect(windows.map((w) => w[1].atUt)).toEqual(nodes.map((n) => n.UT));
  });

  it("has no window at all when there are no nodes", () => {
    expect([].map(() => burnInstantRows({ ut: 0 }))).toHaveLength(0);
  });
});
