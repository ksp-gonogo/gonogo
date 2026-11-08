import { getViewUt } from "@ksp-gonogo/sitrep-client";
import { magnitudeOf } from "@ksp-gonogo/sitrep-sdk";

/**
 * The view instant in plain UT seconds, or undefined with no clock mounted:
 * what a host service stores, sends to stations and settles against, such as an
 * alarm's fired time or the instant a maneuver trigger was armed.
 */
export function viewUtSeconds(): number | undefined {
  return magnitudeOf(getViewUt()) ?? undefined;
}
