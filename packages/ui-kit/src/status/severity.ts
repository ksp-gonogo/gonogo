import type { StreamStatusValue, Tone } from "@ksp-gonogo/sitrep-sdk";

/**
 * The tones that take part in a panel's summary: every {@link Tone} but
 * `neutral`, which carries no state and so has no rank.
 */
export type Severity = Exclude<Tone, "neutral">;

/**
 * Total order for the max-merge, best to worst.
 *
 * `info` sits above `go`, so an info contributor lights an otherwise quiet
 * panel. `offline` sits at the top: a nogo alarm cannot be trusted once the
 * data feeding it is gone.
 */
const RANK: Record<Severity, number> = {
  go: 0,
  info: 1,
  caution: 2,
  warn: 3,
  nogo: 4,
  offline: 5,
};

export function severityRank(s: Severity): number {
  return RANK[s];
}

/** The worst (highest-rank) severity among a set. Empty is the floor, `go`. */
export function worstSeverity(severities: readonly Severity[]): Severity {
  let worst: Severity = "go";
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
      return "go";
    case "resyncing":
      return "caution";
    case "recorded":
      return "info";
    case "held":
    case "last-before-blackout":
      return "warn";
    case "disconnected":
    case "absent":
      return "offline";
  }
}
