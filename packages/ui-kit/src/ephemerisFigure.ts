import {
  asDeterministic,
  type CelestialBody,
  poseAtIndex,
  type SystemPoses,
  type Value,
  value,
} from "@ksp-gonogo/sitrep-sdk";
import type { UnitValue } from "./readingCurrency";

/**
 * Turns a quantity computed from the body catalogue into the figure a readout
 * draws, carrying how exact and how current it is. Made by
 * {@link ephemerisFigureOf}; hand the result to `Unit`'s `value`.
 *
 * @category Unit
 */
export type EphemerisFigure = <Unit extends string>(
  figure: Value<Unit>,
) => UnitValue<Unit>;

/**
 * The figure-maker for quantities computed from `bodies`' orbits and the clock
 * alone: a phase angle between two planets, a transfer window between them, a
 * pair's separation. Pass the poses `useSystemInstant` returns and the bodies
 * the figure rests on.
 *
 * The figure is as current as the least current pose it rests on. Where every
 * one of those poses is `exact` (on a fixed conic, an orbit that never changes, as every body of a stock
 * install is) the figure is stamped deterministic and takes no mark, however long
 * ago the catalogue last arrived. Where any is `held`, because the instant is
 * past its provider's horizon or the catalogue stopped arriving under a body
 * that drifts, the figure comes back held as of the oldest of them. A `modelled`
 * pose claims no exactness and takes no mark.
 *
 * A figure that also rests on the craft does not come through here: give it
 * the craft's mark with {@link derivedMarking}, since one inexact input makes
 * the result inexact.
 *
 * @category Unit
 */
export function ephemerisFigureOf(
  poses: SystemPoses | undefined,
  bodies: readonly (CelestialBody | null | undefined)[],
): EphemerisFigure {
  const resting = bodies.map((body) =>
    body == null ? null : poseAtIndex(poses, body.index),
  );
  const exact =
    resting.length > 0 && resting.every((pose) => pose?.currency === "exact");
  const heldAt = resting.reduce<number | null>((oldest, pose) => {
    if (pose?.currency !== "held" || pose.asOfUt === null) return oldest;
    return oldest === null ? pose.asOfUt : Math.min(oldest, pose.asOfUt);
  }, null);
  return (figure) => {
    const drawn = exact ? asDeterministic(figure) : figure;
    if (heldAt === null) return drawn;
    return {
      state: "held",
      value: drawn,
      asOfUt: value("ut", heldAt) as Value<"ut">,
      grade: "held",
      reckoning: { status: "none" },
    };
  };
}
