import { Situation } from "@ksp-gonogo/sitrep-sdk";

/**
 * Whether the vessel is on the ground and has no descent left to evaluate, off the `Situation` ordinal.
 *
 * `PreLaunch` and `Splashed` count, since a pad craft slightly above the terrain datum still solves to a finite time-to-impact. An absent or unrecognised situation yields false, and the caller falls back to its other grounded signals.
 */
export function isGroundedSituation(
  situation: number | null | undefined,
): boolean {
  return (
    situation === Situation.Landed ||
    situation === Situation.Splashed ||
    situation === Situation.PreLaunch
  );
}
