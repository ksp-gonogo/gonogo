import type { Strategy } from "./types";

/** The lists one screenful of strategies is drawn as. */
export function partition(strategies: readonly Strategy[]): {
  active: Strategy[];
  available: Strategy[];
  softBlocked: Strategy[];
  ineligible: Strategy[];
  unknown: Strategy[];
} {
  const inactive = strategies.filter((s) => !s.isActive);
  // A strategy nobody could judge is neither a yes nor a no.
  const answered = inactive.filter((s) => s.canActivate !== null);
  return {
    active: strategies.filter((s) => s.isActive),
    available: answered.filter(
      (s) => s.canActivate || s.activateBlockedReason === "",
    ),
    // The per-level active cap is a soft block: the strategy is eligible once the running one is deactivated.
    softBlocked: answered.filter(
      (s) =>
        !s.canActivate &&
        /active strategies at this level/i.test(s.activateBlockedReason),
    ),
    ineligible: answered.filter(
      (s) =>
        !s.canActivate &&
        s.activateBlockedReason !== "" &&
        !/active strategies at this level/i.test(s.activateBlockedReason),
    ),
    unknown: inactive.filter((s) => s.canActivate === null),
  };
}

/**
 * The one account a whole bucket shares, or null when they differ. A failed
 * reading usually fails the whole roster at once, so its reason is said once
 * above the list rather than repeated on every card.
 */
export function sharedReason(strategies: readonly Strategy[]): string | null {
  const first = strategies[0]?.activateBlockedReason ?? "";
  if (first === "") return null;
  return strategies.every((s) => s.activateBlockedReason === first)
    ? first
    : null;
}

/** The highest active-strategy cap the blocked-reason text names, or null when nothing is soft-blocked. */
export function inferCap(softBlocked: readonly Strategy[]): number | null {
  for (const s of softBlocked) {
    const m = s.activateBlockedReason.match(/(\d+)\s+active strategies/i);
    if (!m) continue;
    const n = Number(m[1]);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return null;
}
