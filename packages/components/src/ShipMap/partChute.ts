import type { PartStateModule } from "@ksp-gonogo/core";

/** What each parachute state means, in words, for the part tooltip and the part's accessible name. */
export const CHUTE_STATE_TEXT: ReadonlyMap<string, string> = new Map([
  ["stowed", "stowed"],
  ["armed", "armed, waiting for its deploy trigger"],
  ["extended", "deployed"],
  ["broken", "cut away"],
  ["unknown", "state not recognised"],
]);

/** The parachute module's state on a part, or undefined when the part reports none. */
export function chuteStateOf(
  partState: readonly PartStateModule[] | undefined,
): string | undefined {
  return partState?.find((m) => m.type === "parachute")?.state;
}
