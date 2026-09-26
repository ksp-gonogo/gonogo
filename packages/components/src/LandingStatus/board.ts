/**
 * The landing board: which class of readouts the widget shows, so it never states a confident number from a model that does not apply.
 *
 * - `not-descending`: no burn datum (not falling toward terrain)
 * - `atmospheric-aware`: the mod's terminal-velocity model is present (`vessel.landing.terminalVelocity`)
 * - `atmospheric-estimate`: descending in atmosphere with no terminal velocity yet; a partial read (velocity, air density, above-terminal note), since a real atmospheric descent must never read blank
 * - `atmospheric-unmodelled`: atmosphere present and no body data to model against
 * - `no-solution`: vacuum body without body data
 * - `vacuum-solved`: the full-vector suicide-burn solution is valid
 */

import type { LandingSolutionState } from "./solveLanding";

export type LandingBoard =
  | "not-descending"
  | "no-solution"
  | "atmospheric-unmodelled"
  | "atmospheric-estimate"
  | "atmospheric-aware"
  | "vacuum-solved";

export interface BoardInputs {
  /** The burn-solve state from `solveSuicideBurn`. */
  solutionState: LandingSolutionState;
  /** Whether the parent body has an atmosphere (drives the vacuum/atmo split). */
  atmospheric: boolean;
  /** Whether the mod's atmosphere-aware estimate (a `vessel.landing` terminal velocity) is available this tick. */
  atmosphereAware?: boolean;
}

/** Precedence, highest first: not descending shows nothing; an atmospheric body shows the aware estimate or suppresses the vacuum-only solve; a vacuum body missing data is `no-solution`; otherwise the vacuum solution stands. */
export function deriveBoard({
  solutionState,
  atmospheric,
  atmosphereAware = false,
}: BoardInputs): LandingBoard {
  if (solutionState === "not-descending") return "not-descending";
  if (atmospheric) {
    if (atmosphereAware) return "atmospheric-aware";
    // Still a partial read; only with no body data at all is there nothing to show.
    return solutionState === "vacuum-solved"
      ? "atmospheric-estimate"
      : "atmospheric-unmodelled";
  }
  if (solutionState === "no-solution") return "no-solution";
  return "vacuum-solved";
}
