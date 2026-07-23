/**
 * The landing "board" state machine — which class of readouts the widget shows,
 * derived from the burn-solve state and whether the body has an atmosphere.
 *
 * This was an inline ternary in the widget body; it is extracted here as a pure,
 * tested function so the presentation redesign consumes a verified state machine
 * rather than reimplementing a buried conditional. Behaviour is preserved
 * exactly — see board.test.ts for the pinned truth table.
 *
 * The board drives WHICH readouts exist, so the widget never shows a confident
 * number from a model that does not apply:
 * - `not-descending`         — no burn datum yet (not falling toward terrain)
 * - `atmospheric-unmodelled` — an atmosphere is present and the vacuum solve is
 *   suppressed rather than shown wrong. (Becomes `atmospheric-aware` once the
 *   terminal-velocity model lands — see the landing-widget plan, B3.)
 * - `no-solution`            — vacuum body but body data is unavailable
 * - `vacuum-solved`          — the full-vector suicide-burn solution is valid
 */

import type { LandingSolutionState } from "./solveLanding";

export type LandingBoard =
  | "not-descending"
  | "no-solution"
  | "atmospheric-unmodelled"
  | "vacuum-solved";

export interface BoardInputs {
  /** The burn-solve state from `solveSuicideBurn`. */
  solutionState: LandingSolutionState;
  /** Whether the parent body has an atmosphere (drives the vacuum/atmo split). */
  atmospheric: boolean;
}

/**
 * Precedence, highest first: a craft that is not descending shows nothing
 * regardless of body; an atmospheric body suppresses the (vacuum-only) solve
 * even when it would otherwise solve or fail; a vacuum body with missing data is
 * `no-solution`; otherwise the vacuum solution stands.
 */
export function deriveBoard({
  solutionState,
  atmospheric,
}: BoardInputs): LandingBoard {
  if (solutionState === "not-descending") return "not-descending";
  if (atmospheric) return "atmospheric-unmodelled";
  if (solutionState === "no-solution") return "no-solution";
  return "vacuum-solved";
}
