import type { Reading, TopicPayload } from "@ksp-gonogo/sitrep-sdk";
import {
  bandFor,
  bandIn,
  bandIsWellFormed,
  value,
} from "@ksp-gonogo/sitrep-sdk";
import { makeMeta, setupStreamFixture } from "@ksp-gonogo/sitrep-sdk/testing";
import { describe, expect, it } from "vitest";
import "./crewReckoning";
import {
  CREW_DEGENERATION_HORIZON_SECONDS,
  CREW_HISTORY,
  fitSlope,
} from "./crewReckoning";

/**
 * Carrying a kerbal's survival accumulators forward at the rate they are
 * OBSERVED to be moving, not at the rate the profile declares.
 *
 * `KerbalismCrewRule` publishes both, side by side, and the declared one is a
 * trap: `degenPerSec` is a config constant off `Profile.rules[].degeneration`,
 * and the contract says in terms that "a rule only degenerates once its input
 * resource is gone". Integrating it unconditionally would kill a perfectly
 * healthy kerbal on schedule. The declared window is what makes the honest
 * version possible: two samples of `value` are the rate that is ACTUALLY
 * happening, and a flat pair says the rule is not degenerating at all.
 *
 * Every fixture spaces its samples irregularly. The stream is change-gated, so
 * a topic carries a point when its value changed and at no other time, and
 * nothing here may depend on a fixed interval.
 */

const CARRIED = ["kerbalism.crew"];

type Crew = TopicPayload<"kerbalism.crew">;

/** One kerbal carrying one rule: accumulator `at`, stamped at `asOfUt`. */
function crew(at: number, asOfUt: number, threshold = 1): Crew {
  return [
    {
      name: "Jeb",
      trait: "Pilot",
      asOfUt: value("ut", asOfUt),
      deathClockUt: value("ut", asOfUt + 500),
      rules: [
        {
          name: "hunger",
          value: value("units", at),
          degenPerSec: value("units/s", 0.002),
          fatalThreshold: value("units", threshold),
        },
      ],
    },
  ];
}

function ingest(
  fixture: ReturnType<typeof setupStreamFixture>,
  validAt: number,
  payload: Crew,
) {
  fixture.store.ingest("kerbalism.crew", {
    validAt,
    payload,
    meta: makeMeta({ validAt, deliveredAt: validAt }),
    epoch: 0,
  });
}

/**
 * A run of samples given as `[validAt, accumulator, asOfUt]` triples, so a
 * fixture states its own spacing and its own stamp lag rather than inheriting
 * either from a helper.
 */
function readRun(
  viewUt: number,
  run: readonly (readonly [number, number, number])[],
  threshold = 1,
): Reading<Crew> {
  const fixture = setupStreamFixture({
    carriedChannels: CARRIED,
    pinnedUt: viewUt,
  });
  for (const [validAt, at, asOfUt] of run) {
    ingest(fixture, validAt, crew(at, asOfUt, threshold));
  }
  fixture.store.beginFrame();
  return fixture.store.sampleReading<Crew>("kerbalism.crew");
}

function reckonedRun(
  viewUt: number,
  run: readonly (readonly [number, number, number])[],
  threshold = 1,
): Crew {
  const reading = readRun(viewUt, run, threshold);
  if (reading.reckoning !== "available") {
    throw new Error(`expected a model, got reckoning "${reading.reckoning}"`);
  }
  return reading.reckoned.value;
}

/** Climbing by 0.01/s of STAMP time, sampled at three uneven wire instants. */
const CLIMBING = [
  [1000, 0.1, 1000],
  [1017, 0.3, 1020],
  [1049, 0.5, 1040],
] as const;

/** Read but not moving: the rule's input resource is still aboard. */
const FLAT = [
  [1000, 0.1, 1000],
  [1031, 0.1, 1020],
  [1049, 0.1, 1040],
] as const;

describe("the slope it takes from the window", () => {
  it("is a least-squares fit over the pairs, so uneven spacing costs nothing", () => {
    // Exactly 0.01 per second at three unevenly spaced stamps.
    expect(
      fitSlope([
        [0, 0],
        [20, 0.2],
        [40, 0.4],
      ])?.perSecond,
    ).toBeCloseTo(0.01, 9);
    expect(
      fitSlope([
        [0, 0],
        [3, 0.03],
        [40, 0.4],
      ])?.perSecond,
    ).toBeCloseTo(0.01, 9);
  });

  it("is null when every pair shares one instant, which is not a slope", () => {
    // Two wire points can carry the same `asOfUt`: the craft has not taken its
    // Kerbalism turn between them, so the pair spans no time at all.
    expect(
      fitSlope([
        [40, 0.4],
        [40, 0.5],
      ]),
    ).toBeNull();
  });

  it("is null from a single pair", () => {
    expect(fitSlope([[40, 0.4]])).toBeNull();
  });

  it("has no standard error at two samples, because a line through two is exact", () => {
    // `n - 2` degrees of freedom left, so the variance is 0/0. Arithmetic
    // rather than caution, and the reason `bandAt` answers nothing there.
    const fit = fitSlope([
      [0, 0],
      [40, 0.4],
    ]);

    expect(fit?.perSecond).toBeCloseTo(0.01, 9);
    expect(fit?.sigma).toBeUndefined();
  });

  it("has a zero standard error on a perfectly straight three-point run", () => {
    expect(
      fitSlope([
        [0, 0],
        [20, 0.2],
        [40, 0.4],
      ])?.sigma,
    ).toBeCloseTo(0, 9);
  });

  it("widens the standard error when the residuals grow, holding the slope", () => {
    const straight = fitSlope([
      [0, 0],
      [20, 0.2],
      [40, 0.4],
    ]);
    // Same endpoints, so the same fitted slope; the middle sample is off the
    // line, so the fit is less sure of it.
    const scattered = fitSlope([
      [0, 0],
      [20, 0.35],
      [40, 0.4],
    ]);

    expect(scattered?.perSecond).toBeCloseTo(straight?.perSecond ?? 0, 9);
    expect(scattered?.sigma ?? 0).toBeGreaterThan(straight?.sigma ?? 0);
  });
});

describe("carrying an accumulator forward", () => {
  it("integrates the observed slope from the entry's own stamp", () => {
    // 0.01/s observed; the newest stamp is UT 1040, asked at UT 1060.
    const jeb = reckonedRun(1060, CLIMBING)[0];

    expect(jeb.rules?.[0].value?.magnitude).toBeCloseTo(0.7, 6);
  });

  it("names the accumulator it moved, and nothing else on the kerbal", () => {
    const reading = readRun(1060, CLIMBING);
    if (reading.reckoning !== "available") throw new Error("no model");

    expect(reading.reckoned.modelled.map((f) => f.path)).toEqual([
      "",
      "0.rules.0.value",
    ]);
    expect(reading.reckoned.basis).toBe("rate-integration");
    expect(reading.reckoned.owner).toBe("kerbalism");
  });

  it("leaves the mod's own death clock alone rather than restamping it", () => {
    // `deathClockUt` is an INSTANT the mod derived from a reading taken at
    // `asOfUt`, and its contract says it is not restamped to now. Advancing it
    // here would move a deadline nobody moved.
    // The newest sample stamps UT 1040, so the mod's deadline is UT 1540 and
    // stays UT 1540 however far the accumulator beside it is carried.
    expect(reckonedRun(1060, CLIMBING)[0].deathClockUt?.magnitude).toBe(1540);
  });

  it("carries the name, the trait and the declared rate through untouched", () => {
    const jeb = reckonedRun(1060, CLIMBING)[0];

    expect(jeb.name).toBe("Jeb");
    expect(jeb.trait).toBe("Pilot");
    expect(jeb.rules?.[0].degenPerSec?.magnitude).toBe(0.002);
    expect(jeb.rules?.[0].fatalThreshold?.magnitude).toBe(1);
  });

  it("stops at the fatal threshold, which is where this model stops applying", () => {
    // 0.01/s from 0.5 reaches 1.0 in 50 s; asked 200 s past the stamp.
    expect(
      reckonedRun(1240, CLIMBING)[0].rules?.[0].value?.magnitude,
    ).toBeCloseTo(1, 6);
  });

  it("leaves the observation itself unmodelled, which is what `value` promises", () => {
    // `Reading.value` is the last REAL observation on both arms, and a model
    // that wrote its answer into the payload it was handed would make the two
    // the same object. The accumulator sits two levels down, so this only holds
    // if the clone goes that deep.
    const reading = readRun(1060, CLIMBING);
    if (reading.reckoning !== "available") throw new Error("no model");

    expect(reading.reckoned.value[0].rules?.[0].value?.magnitude).toBeCloseTo(
      0.7,
      6,
    );
    expect(reading.value[0].rules?.[0].value?.magnitude).toBe(0.5);
  });

  it("never drives a recovering accumulator below zero", () => {
    const recovering = [
      [1000, 0.5, 1000],
      [1031, 0.3, 1020],
      [1049, 0.1, 1040],
    ] as const;

    expect(reckonedRun(1100, recovering)[0].rules?.[0].value?.magnitude).toBe(
      0,
    );
  });
});

/**
 * A crew list is a ROSTER, so the join across the window has to be by name.
 * Position is not identity: a kerbal transfers off, and index 1 in an older
 * sample is a different person from index 1 in the newest one.
 */
describe("joining the window to the observation", () => {
  /** Two kerbals, either of whom may be missing from a given sample. */
  function roster(
    asOfUt: number,
    people: readonly (readonly [string, number])[],
  ): Crew {
    return people.map(([name, at]) => ({
      name,
      trait: "Pilot",
      asOfUt: value("ut", asOfUt),
      deathClockUt: value("ut", asOfUt + 500),
      rules: [
        {
          name: "hunger",
          value: value("units", at),
          degenPerSec: value("units/s", 0.002),
          fatalThreshold: value("units", 1e6),
        },
      ],
    }));
  }

  function readRoster(
    viewUt: number,
    run: readonly (readonly [number, Crew])[],
  ): Reading<Crew> {
    const fixture = setupStreamFixture({
      carriedChannels: CARRIED,
      pinnedUt: viewUt,
    });
    for (const [validAt, payload] of run) {
      ingest(fixture, validAt, payload);
    }
    fixture.store.beginFrame();
    return fixture.store.sampleReading<Crew>("kerbalism.crew");
  }

  it("gives each kerbal their own slope even when one of them is not moving", () => {
    // Bill climbs at 0.01/s, Bob is supplied and flat. A fit that joined by
    // position would still be right here; the next case is the one that breaks.
    const reading = readRoster(1060, [
      [
        1000,
        roster(1000, [
          ["Bill", 0.1],
          ["Bob", 0.4],
        ]),
      ],
      [
        1023,
        roster(1020, [
          ["Bill", 0.3],
          ["Bob", 0.4],
        ]),
      ],
      [
        1049,
        roster(1040, [
          ["Bill", 0.5],
          ["Bob", 0.4],
        ]),
      ],
    ]);
    if (reading.reckoning !== "available") throw new Error("no model");

    expect(reading.reckoned.modelled.map((f) => f.path)).toEqual([
      "",
      "0.rules.0.value",
    ]);
    expect(reading.reckoned.value[0].rules?.[0].value?.magnitude).toBeCloseTo(
      0.7,
      6,
    );
    expect(reading.reckoned.value[1].rules?.[0].value?.magnitude).toBe(0.4);
  });

  it("drops samples from another craft, which the store does not cut the window at", () => {
    /*
     * A break in the RECORD is truncated before a model sees it; a change of
     * SUBJECT is not a break, so the window can straddle a vessel switch. Two
     * craft each carry a kerbal called Bill here, which KSP permits, and their
     * accumulators are nothing to do with each other: a fit across both reads
     * the step between them as an enormous degeneration.
     *
     * Bill-on-`other` is climbing steeply and Bill-on-`ours` is flat, so a
     * model that ignored `meta.source` would offer a model at all, and one
     * that respects it declines.
     */
    const fixture = setupStreamFixture({
      carriedChannels: CARRIED,
      pinnedUt: 1060,
    });
    const runs: readonly (readonly [number, string, number, number])[] = [
      [1000, "other", 0.1, 1000],
      [1017, "other", 0.6, 1020],
      [1031, "ours", 0.4, 1030],
      [1049, "ours", 0.4, 1040],
    ];
    for (const [validAt, source, at, asOfUt] of runs) {
      fixture.store.ingest("kerbalism.crew", {
        validAt,
        payload: roster(asOfUt, [["Bill", at]]),
        meta: makeMeta({ validAt, deliveredAt: validAt, source }),
        epoch: 0,
      });
    }
    fixture.store.beginFrame();

    expect(fixture.store.sampleReading<Crew>("kerbalism.crew").reckoning).toBe(
      "none",
    );
  });

  it("does not read a departed kerbal's history as the newcomer who took their slot", () => {
    // Bob leaves and Val boards. Joining by POSITION would fit Val's slope from
    // Bob's readings, which is somebody else's starvation attributed to her.
    const reading = readRoster(1060, [
      [
        1000,
        roster(1000, [
          ["Bill", 0.1],
          ["Bob", 0.9],
        ]),
      ],
      [
        1023,
        roster(1020, [
          ["Bill", 0.3],
          ["Bob", 0.5],
        ]),
      ],
      [
        1049,
        roster(1040, [
          ["Bill", 0.5],
          ["Val", 0.2],
        ]),
      ],
    ]);
    if (reading.reckoning !== "available") throw new Error("no model");

    // Only Bill. Val contributes one pair, which is not a slope, so she is
    // carried verbatim rather than handed a stranger's decline.
    expect(reading.reckoned.modelled.map((f) => f.path)).toEqual([
      "",
      "0.rules.0.value",
    ]);
    expect(reading.reckoned.value[1].name).toBe("Val");
    expect(reading.reckoned.value[1].rules?.[0].value?.magnitude).toBe(0.2);
  });
});

describe("when the model refuses", () => {
  it("offers nothing on a flat accumulator, whatever the profile's rate says", () => {
    // The whole point: `degenPerSec` is 0.002 in every fixture here, so a model
    // integrating the DECLARED rate would answer 0.14 for this kerbal.
    expect(readRun(1060, FLAT).reckoning).toBe("none");
  });

  it("offers nothing from a single sample", () => {
    // Two things refuse this and only one of them is the model: the store
    // raises `insufficient-history` on its behalf below `minSamples`, and
    // `observedSlope` refuses a lone pair anyway. The floor is the cheaper of
    // the two, so the assertion that pins it is on the declaration below.
    expect(readRun(1060, [CLIMBING[2]]).reckoning).toBe("none");
  });

  it("offers nothing past the horizon", () => {
    const inside = 1040 + CREW_DEGENERATION_HORIZON_SECONDS - 1;
    const outside = 1040 + CREW_DEGENERATION_HORIZON_SECONDS + 1;

    // A high threshold, so the clamp is not what withdraws the model instead.
    expect(readRun(inside, CLIMBING, 1e6).reckoning).toBe("available");
    expect(readRun(outside, CLIMBING, 1e6).reckoning).toBe("none");
  });

  it("declares a window with a floor of two, because one point is not a slope", () => {
    expect(CREW_HISTORY.minSamples).toBe(2);
  });
});

/**
 * The band, and why this model can offer one where `resourceReckoning.ts`
 * cannot.
 *
 * Its rate is a FIT, so it has residuals, and residuals are evidence about how
 * well the trend is known. `resourceReckoning`'s rate is one measured sample
 * off the wire with no distribution behind it, so a band there would be
 * fabricated. `sigma1` is the honest kind here and `bound` would not be: a
 * standard error is not a limit, and the true value sits outside one about a
 * third of the time.
 */
describe("how well it says it knows the answer", () => {
  /** Climbing at 0.01/s with the middle sample off the line, so sigma > 0. */
  const SCATTERED = [
    [1000, 0.1, 1000],
    [1023, 0.35, 1020],
    [1049, 0.5, 1040],
  ] as const;

  function bandOf(
    viewUt: number,
    run: readonly (readonly [number, number, number])[] = SCATTERED,
    threshold = 1e6,
  ) {
    const reading = readRun(viewUt, run, threshold);
    if (reading.reckoning !== "available") throw new Error("no model");
    return bandIn(bandFor(reading.reckoned, "0.rules.0.value"), "units");
  }

  it("keys the band by the same path `modelled` names", () => {
    const reading = readRun(1060, SCATTERED, 1e6);
    if (reading.reckoning !== "available") throw new Error("no model");

    // The two line up without a join, which is the whole point of sharing the
    // path vocabulary. A band under a path nothing modelled is a producer bug
    // nothing rejects, because a consumer reads bands BY path.
    expect(Object.keys(reading.reckoned.bands ?? {})).toEqual(
      reading.reckoned.modelled
        .map((f) => f.path)
        .filter((path) => path !== ""),
    );
  });

  it("is well formed, which is the producer's own check to make", () => {
    const band = bandOf(1060);
    if (!band) throw new Error("no band");

    expect(bandIsWellFormed(band)).toBe(true);
  });

  it("centres on the same number `reckon` produced, not a second copy of it", () => {
    /*
     * Weaker than it looks, and worth saying so: inside the clamp both
     * formulas are `from + slope * dt` and agree exactly, so replacing
     * `carriedValue` with a second copy of the arithmetic passes this. What
     * actually catches that is the clamp assertion below, which is where the
     * two diverge. Measured by planting exactly that change.
     */
    const reading = readRun(1060, SCATTERED, 1e6);
    if (reading.reckoning !== "available") throw new Error("no model");
    const band = bandIn(bandFor(reading.reckoned, "0.rules.0.value"), "units");

    expect(band?.value.magnitude).toBe(
      reading.reckoned.value[0].rules?.[0].value?.magnitude,
    );
  });

  it("widens with the interval, because that is what carrying a fitted rate costs", () => {
    const near = bandOf(1060);
    const far = bandOf(1200);
    const width = (b: typeof near) => (b ? b.hi.magnitude - b.lo.magnitude : 0);

    expect(width(near)).toBeGreaterThan(0);
    expect(width(far)).toBeGreaterThan(width(near) * 2);
  });

  it("scales its width with the interval exactly, since dt is the only thing carried", () => {
    /*
     * The half-width is `|at - asOfUt| * sigma(slope)`, so doubling the
     * interval doubles the width and there is no other term. Written as a
     * ratio rather than as "it collapses at the stamp", which was the first
     * shape of this test and is unreachable: the window's anchor is the newest
     * point at-or-before the view time, and that point's own `asOfUt` sits
     * BEHIND its `validAt` by however long the craft waited for its Kerbalism
     * turn, so the store can never ask a model for the instant its
     * accumulators were advanced at.
     */
    const width = (viewUt: number) => {
      const band = bandOf(viewUt);
      return band ? band.hi.magnitude - band.lo.magnitude : 0;
    };
    // 20 s and 40 s past the anchor's own stamp of UT 1040.
    const near = width(1060);

    expect(near).toBeGreaterThan(0);
    expect(width(1080) / near).toBeCloseTo(2, 6);
  });

  it("says sigma1 and never bound, a standard error not being a limit", () => {
    expect(bandOf(1060)?.kind).toBe("sigma1");
  });

  it("narrows to almost nothing on a straight run rather than withdrawing", () => {
    /*
     * The fit's standard error over a straight run is zero up to floating
     * point, so the band closes onto its own value. `bandIsWellFormed` accepts
     * `lo === value === hi` as the strong claim it is, and a model that
     * withdrew here instead would hide its most confident answer.
     *
     * `toBeCloseTo`, not `toBe`: the residuals of a straight line are around
     * 1e-18 rather than 0, so the ends differ from the centre in the last bits.
     */
    const band = bandOf(1060, CLIMBING);
    if (!band) throw new Error("no band");

    expect(band.hi.magnitude - band.lo.magnitude).toBeCloseTo(0, 9);
    expect(bandIsWellFormed(band)).toBe(true);
  });

  it("offers no bands at all from a two-sample window", () => {
    const reading = readRun(1060, [SCATTERED[1], SCATTERED[2]], 1e6);
    if (reading.reckoning !== "available") throw new Error("no model");

    // `undefined` rather than an empty map: a model that bands nothing says so
    // by absence, and the store's own doc asks for exactly that.
    expect(reading.reckoned.bands).toBeUndefined();
  });

  it("keeps both ends inside the range the accumulator can actually occupy", () => {
    // Threshold 0.55, so the carried value clamps and a band that ignored the
    // clamp would put `hi` above a state in which the kerbal is already dead.
    const band = bandOf(1200, SCATTERED, 0.55);

    expect(band?.hi.magnitude).toBeLessThanOrEqual(0.55);
    expect(band?.lo.magnitude).toBeGreaterThanOrEqual(0);
    if (band) expect(bandIsWellFormed(band)).toBe(true);
  });
});
