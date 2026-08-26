import { value } from "@ksp-gonogo/sitrep-sdk";
import { describe, expect, it } from "vitest";
import type { Rp1FundingCurveKey } from "../__generated__/contract";
import {
  evaluateFundingCurve,
  plainCurveKeys,
  sampleFundingCurve,
} from "./fundingCurve";

const YEAR = 31_557_600;

/**
 * RP-1's shipped `Flat` curve, key for key from ProgramHandlerSettings.cfg. Its
 * first two keys are the Hermite spelling of a straight line, which is what
 * makes the arithmetic below checkable by hand: any curvature between 0 and 1 is
 * the basis functions being wrong rather than the curve bending.
 */
function flatKeys(): Rp1FundingCurveKey[] {
  return [
    {
      frac: value("ratio", 0),
      paidFraction: value("ratio", 0),
      inTangent: value("1", 1),
      outTangent: value("1", 1),
    },
    {
      frac: value("ratio", 1),
      paidFraction: value("ratio", 1),
      inTangent: value("1", 1),
      outTangent: value("1", 0.8),
    },
    {
      frac: value("ratio", 2),
      paidFraction: value("ratio", 1.4),
      inTangent: value("1", 0.25),
      outTangent: value("1", 0.25),
    },
  ];
}

describe("reading a funding curve off the wire", () => {
  it("keeps a real zero key rather than dropping it", () => {
    // The origin key is (0, 0): a Program starts having been paid nothing, and
    // that IS the reading. A falsy-check on the coordinates would drop it and
    // start every curve at its second key.
    const keys = plainCurveKeys(flatKeys());
    expect(keys?.[0]).toEqual({
      frac: 0,
      paidFraction: 0,
      inTangent: 1,
      outTangent: 1,
    });
  });

  it("sorts keys ascending rather than trusting the wire's order", () => {
    const shuffled = [flatKeys()[2], flatKeys()[0], flatKeys()[1]];
    expect(plainCurveKeys(shuffled)?.map((k) => k.frac)).toEqual([0, 1, 2]);
  });

  it("reads an absent curve as absent, never as a curve with no keys", () => {
    // A curve that pays nothing and a curve nobody could read are different
    // facts. Only the second must never reach a chart, because it draws as a
    // flat line along the bottom and reads as the first.
    expect(plainCurveKeys(undefined)).toBeNull();
    expect(plainCurveKeys([])).toBeNull();
  });

  it("drops a key whose coordinates did not arrive", () => {
    const partial: Rp1FundingCurveKey[] = [
      ...flatKeys(),
      { inTangent: value("1", 0), outTangent: value("1", 0) },
    ];
    expect(plainCurveKeys(partial)).toHaveLength(3);
  });
});

describe("evaluating a funding curve", () => {
  it.each([
    [0, 0],
    [0.25, 0.25],
    [0.5, 0.5],
    [0.75, 0.75],
    [1, 1],
  ])("pays Flat in proportion at %f", (frac, expected) => {
    expect(evaluateFundingCurve(plainCurveKeys(flatKeys()), frac)).toBeCloseTo(
      expected,
      12,
    );
  });

  it("clamps to the end keys rather than extrapolating", () => {
    // What stops a Program warped far past its deadline from accruing money
    // RP-1 will never pay: its own Evaluate returns the first and last key's
    // value outside the range.
    const keys = plainCurveKeys(flatKeys());
    expect(evaluateFundingCurve(keys, -5)).toBeCloseTo(0, 12);
    expect(evaluateFundingCurve(keys, 40)).toBeCloseTo(1.4, 12);
  });

  it("holds the left key across a stepped segment", () => {
    // Keys built by hand rather than read off the wire, because a stepped key
    // cannot cross it: JSON has no infinity and `magnitudeOf` rejects a
    // non-finite magnitude, so `plainCurveKeys` drops the key entirely. What
    // this pins is the evaluator's own contract, which is exported.
    expect(
      evaluateFundingCurve(
        [
          {
            frac: 0,
            paidFraction: 0.2,
            inTangent: Number.POSITIVE_INFINITY,
            outTangent: Number.POSITIVE_INFINITY,
          },
          { frac: 1, paidFraction: 1, inTangent: 0, outTangent: 0 },
        ],
        0.5,
      ),
    ).toBeCloseTo(0.2, 12);
  });

  it("drops a key whose tangent did not survive the wire", () => {
    // The reason the branch above is unreachable from a real payload, stated as
    // a test so it is a measured fact rather than a comment: a key with no
    // readable tangent is dropped, never flattened to zero.
    const stepped = plainCurveKeys([
      {
        frac: value("ratio", 0),
        paidFraction: value("ratio", 0.2),
        inTangent: value("1", Number.POSITIVE_INFINITY),
        outTangent: value("1", Number.POSITIVE_INFINITY),
      },
      {
        frac: value("ratio", 1),
        paidFraction: value("ratio", 1),
        inTangent: value("1", 0),
        outTangent: value("1", 0),
      },
    ]);
    expect(stepped?.map((k) => k.frac)).toEqual([1]);
  });

  it("has no answer for a curve it could not read", () => {
    expect(evaluateFundingCurve(null, 0.5)).toBeNull();
  });
});

describe("sampling a funding curve for a chart", () => {
  it("lays a curve out in years and in funds when both are known", () => {
    const sample = sampleFundingCurve({
      keys: plainCurveKeys(flatKeys()),
      totalFunds: 400_000,
      durationSeconds: 4 * YEAR,
      samples: 8,
    });

    expect(sample?.axis).toBe("years");
    expect(sample?.nominalEnd).toBeCloseTo(4, 9);
    // The curve runs to frac 2, so the chart runs to eight years: RP-1 keeps
    // paying past the deadline and a chart stopping at four would hide it.
    expect(sample?.end).toBeCloseTo(8, 9);
    expect(sample?.points[0]).toEqual({ x: 0, funds: 0 });
    const atFourYears = sample?.points.find((p) => Math.abs(p.x - 4) < 1e-9);
    expect(atFourYears?.funds).toBeCloseTo(400_000, 6);
  });

  it("falls back to the curve's own fraction axis when the duration is unknown", () => {
    // The curve is declared in fraction-of-duration, so an unknown duration
    // costs the conversion and nothing else. The sample says which axis it came
    // back on so the caller labels it honestly rather than calling fractions years.
    const sample = sampleFundingCurve({
      keys: plainCurveKeys(flatKeys()),
      totalFunds: 400_000,
      durationSeconds: null,
      samples: 8,
    });

    expect(sample?.axis).toBe("fraction");
    expect(sample?.nominalEnd).toBe(1);
    expect(sample?.end).toBeCloseTo(2, 9);
  });

  it("refuses to draw a funds axis with no funds on it", () => {
    // Without the total there is a shape and no money. Scaling it to 1 and
    // labelling the axis in funds would invent the only quantity the chart
    // claims to show.
    expect(
      sampleFundingCurve({
        keys: plainCurveKeys(flatKeys()),
        totalFunds: null,
        durationSeconds: 4 * YEAR,
      }),
    ).toBeNull();
  });

  it("refuses to draw a curve it could not read", () => {
    expect(
      sampleFundingCurve({
        keys: null,
        totalFunds: 400_000,
        durationSeconds: 4 * YEAR,
      }),
    ).toBeNull();
  });

  it("draws nothing from a single key rather than a dot at the origin", () => {
    const one = plainCurveKeys([flatKeys()[0]]);
    expect(
      sampleFundingCurve({
        keys: one,
        totalFunds: 400_000,
        durationSeconds: 4 * YEAR,
        samples: 8,
      }),
    ).toBeNull();
  });
});
