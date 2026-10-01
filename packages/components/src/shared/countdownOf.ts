import type { OrbitalSolve } from "@ksp-gonogo/sitrep-client";
import {
  pickReading,
  type Reading,
  type Value,
  value,
} from "@ksp-gonogo/sitrep-sdk";

/**
 * One countdown off a solve reading, keeping the conic's figure for the craft's
 * present beside the observed one. `undefined` where the observed solve has no
 * such countdown, so nothing modelled is drawn without an observation under it.
 */
export function countdownOf(
  solve: Reading<OrbitalSolve>,
  pick: (solve: OrbitalSolve) => number | null,
): Reading<Value<"s">> | undefined {
  const countdown = pickReading(solve, (s) => {
    const seconds = pick(s);
    return seconds === null ? undefined : value("s", seconds);
  });
  return countdown.value === undefined ? undefined : countdown;
}
