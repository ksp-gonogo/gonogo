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

/**
 * What is in the way of a strategy the active cap holds back, in the screen's
 * own noun: the cap, and which of the screen's running items can be deactivated
 * to make room. Names none when the running items belong to another screen.
 */
export function capReason(
  running: readonly Strategy[],
  cap: number | null,
  noun: string,
): string {
  const limit =
    cap === null
      ? `The limit of active ${noun}`
      : `The limit of ${cap} active ${noun}`;
  const names = running.map((s) => s.title);
  if (names.length === 0) return `${limit} is reached.`;
  const last = names[names.length - 1];
  const list =
    names.length === 1 ? last : `${names.slice(0, -1).join(", ")} or ${last}`;
  return `${limit} is reached. Deactivate ${list} to make room.`;
}

/** A blocked reason as the clause a control's advice carries: lower case at the start, no closing full stop. */
export function adviceClause(reason: string): string {
  const trimmed = reason.trim().replace(/\.+$/, "");
  return trimmed === "" ? trimmed : trimmed[0].toLowerCase() + trimmed.slice(1);
}
