import type { StreamStatusValue, Tone } from "@ksp-gonogo/sitrep-sdk";

/**
 * The tones that take part in a panel's summary: every `Tone` but `neutral`,
 * which carries no state. From best to worst: `go`, `info`, `caution`, `warn`,
 * `nogo`, `offline`.
 *
 * @category Panel
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

/**
 * The worst severity among `severities`, in the order `go`, `info`, `caution`,
 * `warn`, `nogo`, `offline` (worst). `go` for an empty list.
 *
 * @category Panel
 */
export function worstSeverity(severities: readonly Severity[]): Severity {
  let worst: Severity = "go";
  for (const s of severities) {
    if (RANK[s] > RANK[worst]) worst = s;
  }
  return worst;
}

/**
 * The {@link Severity} a stream status reads as: `live` is `go`, `resyncing`
 * is `caution`, `recorded` is `info` (the reading is exact, for an earlier
 * instant), `held` and `last-before-blackout` are `warn`, and `disconnected`
 * and `absent` are `offline`.
 *
 * @category Panel
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
