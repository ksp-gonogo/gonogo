import {
  asDeterministic,
  type CelestialBody,
  type CelestialFacts,
  type Reading,
  type Value,
} from "@ksp-gonogo/sitrep-sdk";
import type { UnitValue } from "./readingCurrency";

/** Turns a quantity computed from the body catalogue into the figure a readout draws, carrying how exact and how current it is. */
export type EphemerisFigure = <Unit extends string>(
  figure: Value<Unit>,
) => UnitValue<Unit>;

/**
 * The figure-maker for quantities computed from `bodies`' orbits and the clock
 * alone: a phase angle between two planets, a transfer window between them, a
 * pair's separation.
 *
 * Where every one of those bodies is deterministic (a fixed conic, which is
 * every body of a stock install) the figure is stamped deterministic and takes
 * no mark, however long ago the catalogue last arrived: it is exact at the
 * instant it is drawn for. Where any is not (an n-body install, whose bodies
 * drift like craft) the figure is only as current as the catalogue, and a held
 * catalogue hands it over as held.
 *
 * A figure that also rests on the craft does not come through here: it takes
 * the craft's mark, since one inexact input makes the result inexact.
 */
export function ephemerisFigureOf(
  catalogue: Reading<CelestialFacts> | undefined,
  bodies: readonly (CelestialBody | null | undefined)[],
): EphemerisFigure {
  const exact =
    bodies.length > 0 && bodies.every((body) => body?.deterministic === true);
  return (figure) => {
    const drawn = exact ? asDeterministic(figure) : figure;
    if (catalogue?.state !== "held") return drawn;
    return {
      state: "held",
      value: drawn,
      asOfUt: catalogue.asOfUt,
      grade: catalogue.grade,
      reckoning: { status: "none" },
    };
  };
}
