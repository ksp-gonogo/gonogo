import type { BadgeEntry, StreamStatusValue } from "@ksp-gonogo/sitrep-sdk";

/**
 * The one canonical severity vocabulary. `StreamStatusValue` and the published
 * `BadgeEntry.tone` fold onto it via the `severityFrom*` helpers below, so the
 * whole app can aggregate state with a single max-merge.
 */
export type Severity =
  | "nominal"
  | "info"
  | "caution"
  | "warning"
  | "critical"
  | "offline";

/**
 * Total order for the max-merge, best to worst.
 *
 * `info` sits above `nominal`, so an info contributor lights an otherwise
 * quiet panel. `offline` sits at the top: a critical alarm cannot be trusted
 * once the data feeding it is gone.
 */
const RANK: Record<Severity, number> = {
  nominal: 0,
  info: 1,
  caution: 2,
  warning: 3,
  critical: 4,
  offline: 5,
};

export function severityRank(s: Severity): number {
  return RANK[s];
}

/** The worst (highest-rank) severity among a set. Empty is the floor, `nominal`. */
export function worstSeverity(severities: readonly Severity[]): Severity {
  let worst: Severity = "nominal";
  for (const s of severities) {
    if (RANK[s] > RANK[worst]) worst = s;
  }
  return worst;
}

/**
 * `StreamStatusValue` -> `Severity`.
 *
 * `recorded` is `info`, the only status that is not a degradation: the reading
 * is exact, it just describes an earlier instant held aboard through a loss of
 * signal.
 */
export function severityFromStreamStatus(status: StreamStatusValue): Severity {
  switch (status) {
    case "live":
      return "nominal";
    case "resyncing":
      return "caution";
    case "recorded":
      return "info";
    case "held-stale":
    case "last-before-blackout":
      return "warning";
    case "disconnected":
    case "absent":
      return "offline";
  }
}

/**
 * A contributed `BadgeEntry`'s `tone` -> `Severity`.
 *
 * `neutral` folds to the floor so it can take part in a merge. A caller
 * rendering the entry should map `neutral` to no severity instead, which draws
 * the decorative grey chip a kind-tag wants.
 */
export function severityFromBadgeEntryTone(
  tone: NonNullable<BadgeEntry["tone"]>,
): Severity {
  switch (tone) {
    case "neutral":
    case "go":
      return "nominal";
    case "info":
      return "info";
    case "warn":
      return "warning";
    case "nogo":
      return "critical";
  }
}
