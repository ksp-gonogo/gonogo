import { value } from "@ksp-gonogo/sitrep-sdk";
import { describe, expect, it } from "vitest";
import type { PrincipiaOrbitAnalysis } from "./__generated__/contract";
import { orbitDescription } from "./orbitDescription";

function analysis(
  over: Partial<PrincipiaOrbitAnalysis> = {},
): PrincipiaOrbitAnalysis {
  return {
    elementsPresent: true,
    gravitationallyBound: true,
    primaryBody: "Kerbin",
    meanEccentricity: { min: value("1", 0.2), max: value("1", 0.25) },
    meanInclinationDegrees: { min: value("°", 30), max: value("°", 31) },
    ...over,
  };
}

describe("orbitDescription", () => {
  it("names the body even when no adjective applies", () => {
    expect(orbitDescription(analysis())).toBe("Kerbin orbit");
  });

  /**
   * The producer tests the band END, not a midpoint. An orbit whose
   * eccentricity swings from 0 to 0.4 averages under the circular threshold and
   * is nothing like circular, so a midpoint test would print the opposite of
   * what the numbers say.
   */
  it("calls an orbit circular only when it is never eccentric", () => {
    expect(
      orbitDescription(
        analysis({
          meanEccentricity: { min: value("1", 0.001), max: value("1", 0.004) },
        }),
      ),
    ).toBe("circular Kerbin orbit");

    expect(
      orbitDescription(
        analysis({
          meanEccentricity: { min: value("1", 0), max: value("1", 0.4) },
        }),
      ),
    ).toBe("Kerbin orbit");
  });

  it("calls an orbit highly elliptical from the other end of the band", () => {
    expect(
      orbitDescription(
        analysis({
          meanEccentricity: { min: value("1", 0.7), max: value("1", 0.8) },
        }),
      ),
    ).toBe("highly elliptical Kerbin orbit");
  });

  it("reads a retrograde equator as both equatorial and retrograde", () => {
    expect(
      orbitDescription(
        analysis({
          meanInclinationDegrees: {
            min: value("°", 178),
            max: value("°", 179),
          },
        }),
      ),
    ).toBe("equatorial retrograde Kerbin orbit");
  });

  it("calls an orbit polar within ten degrees either side", () => {
    expect(
      orbitDescription(
        analysis({
          meanEccentricity: { min: value("1", 0.001), max: value("1", 0.002) },
          meanInclinationDegrees: { min: value("°", 97), max: value("°", 98) },
        }),
      ),
    ).toBe("circular polar retrograde Kerbin orbit");
  });

  /**
   * An unbound trajectory is not an orbit, so it gets no orbit phrase. The
   * producer makes the same distinction: it prints a warning rather than a
   * shape.
   */
  it("describes nothing for a trajectory bound to nothing", () => {
    expect(
      orbitDescription(analysis({ gravitationallyBound: false })),
    ).toBeNull();
  });

  it("describes nothing when the analysis found no elements", () => {
    expect(orbitDescription(analysis({ elementsPresent: false }))).toBeNull();
  });

  it("describes nothing at all rather than a bare noun", () => {
    expect(
      orbitDescription(
        analysis({
          primaryBody: undefined,
          meanEccentricity: undefined,
          meanInclinationDegrees: undefined,
        }),
      ),
    ).toBeNull();
  });
});

/**
 * The three synchronicity adjectives, which this file used to declare
 * unreachable. They are decided by the DRIFT of the equatorial crossing bands,
 * following the producer's own rule: a track whose crossings barely move is one
 * that repeats.
 */
describe("orbitDescription synchronicity", () => {
  /** A track that closes in one turn of the primary, crossings barely moving. */
  function repeating(
    over: Partial<PrincipiaOrbitAnalysis> = {},
  ): PrincipiaOrbitAnalysis {
    return analysis({
      // One revolution per rotation, one rotation per cycle.
      recurrenceCycleRotations: value("count", 1),
      recurrenceRevolutionsPerRotation: value("count", 1),
      recurrenceRevolutions: value("count", 1),
      // Ten revolutions analysed, so ten rotations at one per rotation.
      missionDurationSeconds: value("s", 216_000),
      nodalPeriodSeconds: value("s", 21_600),
      // 0.05° over ten rotations is 0.005°/rotation, well inside the 0.1° rule.
      ascendingCrossingDegrees: {
        min: value("°", 10.0),
        max: value("°", 10.05),
      },
      descendingCrossingDegrees: {
        min: value("°", 190.0),
        max: value("°", 190.04),
      },
      ...over,
    });
  }

  it("calls a repeating one-per-rotation track synchronous", () => {
    expect(orbitDescription(repeating())).toBe("synchronous Kerbin orbit");
  });

  /**
   * Stationary REPLACES the shape words rather than joining them. The producer
   * says "stationary over Kerbin"; "circular equatorial stationary Kerbin
   * orbit" states the same fact three times.
   */
  it("calls a circular equatorial one stationary, and drops the shape words", () => {
    const described = orbitDescription(
      repeating({
        meanEccentricity: { min: value("1", 0.001), max: value("1", 0.002) },
        meanInclinationDegrees: { min: value("°", 0.1), max: value("°", 0.2) },
      }),
    );
    expect(described).toBe("stationary Kerbin orbit");
  });

  it("calls a two-per-rotation track semi-synchronous", () => {
    expect(
      orbitDescription(
        repeating({
          recurrenceRevolutionsPerRotation: value("count", 2),
          recurrenceRevolutions: value("count", 2),
        }),
      ),
    ).toBe("semi-synchronous Kerbin orbit");
  });

  /**
   * A track that walks is not synchronous however neat its recurrence. This is
   * the assertion that stops the adjective being decided by the recurrence
   * alone, which would name almost every closed orbit.
   */
  it("says nothing when the crossings drift", () => {
    expect(
      orbitDescription(
        repeating({
          ascendingCrossingDegrees: {
            min: value("°", 10),
            max: value("°", 130),
          },
          descendingCrossingDegrees: {
            min: value("°", 190),
            max: value("°", 310),
          },
        }),
      ),
    ).toBe("Kerbin orbit");
  });

  /**
   * Zero drift means the analysis caught ONE pass, and one pass cannot show
   * that anything repeats. Reading it as perfect synchronicity would call every
   * briefly-analysed orbit stationary: the most confident way to be wrong.
   */
  it("refuses zero drift rather than treating it as perfect", () => {
    expect(
      orbitDescription(
        repeating({
          ascendingCrossingDegrees: {
            min: value("°", 10),
            max: value("°", 10),
          },
          descendingCrossingDegrees: {
            min: value("°", 190),
            max: value("°", 190),
          },
        }),
      ),
    ).toBe("Kerbin orbit");
  });

  /** No crossings, no claim: the recurrence on its own decides nothing. */
  it("says nothing from a recurrence with no crossings", () => {
    expect(
      orbitDescription(
        repeating({
          ascendingCrossingDegrees: undefined,
          descendingCrossingDegrees: undefined,
        }),
      ),
    ).toBe("Kerbin orbit");
  });
});

/**
 * Sun-synchronous reads DIFFERENT data from the other three: the local solar
 * time at the nodes holding steady, not the ground track repeating. An orbit can
 * repeat its track without holding its lighting and vice versa, so it joins the
 * other adjectives rather than competing with them.
 */
describe("orbitDescription sun-synchronicity", () => {
  function holdingLighting(
    over: Partial<PrincipiaOrbitAnalysis> = {},
  ): PrincipiaOrbitAnalysis {
    return analysis({
      missionDurationSeconds: value("s", 216_000),
      nodalPeriodSeconds: value("s", 21_600),
      // Ten revolutions; 0.005° total is 0.0005°/rev, inside the 0.001° rule.
      ascendingNodeSolarTimeDegrees: {
        min: value("°", 157.44),
        max: value("°", 157.445),
      },
      descendingNodeSolarTimeDegrees: {
        min: value("°", 337.44),
        max: value("°", 337.444),
      },
      ...over,
    });
  }

  it("says sun-synchronous when the nodes hold their local time", () => {
    expect(orbitDescription(holdingLighting())).toBe(
      "sun-synchronous Kerbin orbit",
    );
  });

  /**
   * The threshold is two orders tighter than the ground-track one, so a drift
   * that would still count as a repeating track is not a held lighting angle.
   */
  it("says nothing when the local time walks", () => {
    expect(
      orbitDescription(
        holdingLighting({
          ascendingNodeSolarTimeDegrees: {
            min: value("°", 157),
            max: value("°", 175),
          },
          descendingNodeSolarTimeDegrees: {
            min: value("°", 337),
            max: value("°", 355),
          },
        }),
      ),
    ).toBe("Kerbin orbit");
  });

  /** A body with no modelled mean sun has no solar times and so no claim. */
  it("says nothing without solar times at all", () => {
    expect(
      orbitDescription(
        holdingLighting({
          ascendingNodeSolarTimeDegrees: undefined,
          descendingNodeSolarTimeDegrees: undefined,
        }),
      ),
    ).toBe("Kerbin orbit");
  });

  /** One pass is no evidence of holding, exactly as for the track rules. */
  it("refuses zero drift", () => {
    expect(
      orbitDescription(
        holdingLighting({
          ascendingNodeSolarTimeDegrees: {
            min: value("°", 157.44),
            max: value("°", 157.44),
          },
          descendingNodeSolarTimeDegrees: {
            min: value("°", 337.44),
            max: value("°", 337.44),
          },
        }),
      ),
    ).toBe("Kerbin orbit");
  });
});
