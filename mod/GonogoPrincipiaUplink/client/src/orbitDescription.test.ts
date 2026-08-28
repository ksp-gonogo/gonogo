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
