import type { BadgeEntry, StreamStatusValue } from "@ksp-gonogo/sitrep-sdk"; // erased at build; no runtime edge
import type { ReadoutTone } from "../Readout";
import type { StatusTone } from "../StatusIndicator";
import type { TextTone } from "../Text";

/**
 * The one canonical severity vocabulary (Scale B, operator-locked 2026-08-05).
 * Every legacy tone/status set folds onto this via the `severityFrom*` helpers
 * below, so the whole app can aggregate state with a single max-merge.
 *
 * Lives in `@ksp-gonogo/ui-kit` rather than `@ksp-gonogo/core` (where the spec
 * first placed it) because core already depends on ui-kit at runtime, so a
 * severity type in core that `Badge`/`Panel` import would be a circular import.
 * ui-kit is the published, export-safe design-system package and the home of
 * `Badge`/`Panel`, so it is the correct floor for the shared vocabulary. Core
 * and the app fold their own private vocabularies onto this type from their own
 * side.
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
 * `info` sits ABOVE `nominal` (operator-locked): an info notice IS the most
 * interesting thing on an otherwise-quiet panel, so an info contributor lights
 * a wholly-nominal panel.
 *
 * `offline` sits at the very top: a panel that has lost its data is the most
 * degraded thing it can be, and that reading must win over any live-data
 * severity beneath it (you cannot trust a critical alarm if the data feeding
 * it is gone). This mirrors `stream-status.ts`'s STATUS_SEVERITY, where
 * absent/disconnected outrank the staleness grades for the same reason.
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

/**
 * The worst (highest-rank) severity among a set. Empty is vacuously the floor
 * (`nominal`). Reuses the exact shape of `worstStatus` in
 * `sitrep-client/stream-status.ts`, deliberately: that function is the proven
 * precedent for max-severity aggregation on this codebase, and status merging
 * is the same operation over a wider vocabulary.
 */
export function worstSeverity(severities: readonly Severity[]): Severity {
  let worst: Severity = "nominal";
  for (const s of severities) {
    if (RANK[s] > RANK[worst]) worst = s;
  }
  return worst;
}

/**
 * `StreamStatusValue` -> `Severity`. The StreamStatus rows of the spec mapping
 * table: a healthy stream is `nominal`, a cold/resyncing one `caution`, the two
 * staleness grades `warning`, and a lost transport or confirmed absence
 * `offline`.
 */
export function severityFromStreamStatus(status: StreamStatusValue): Severity {
  switch (status) {
    case "live":
      return "nominal";
    case "resyncing":
      return "caution";
    case "held-stale":
    case "last-before-blackout":
      return "warning";
    case "disconnected":
    case "absent":
      return "offline";
  }
}

/**
 * `ReadoutTone` -> `Severity`. `default`/`go` are the floor, `warning` and the
 * pulsing `alert` both fold to `warning` (an alert readout is a degrading
 * reading, not yet a data-loss).
 */
export function severityFromReadoutTone(tone: ReadoutTone): Severity {
  switch (tone) {
    case "default":
    case "go":
      return "nominal";
    case "warning":
    case "alert":
      return "warning";
  }
}

/**
 * A contributed `BadgeEntry`'s `tone` -> `Severity`. This is a DATA fold, not a
 * prop one: `Badge` speaks only `Severity`, but the `badges` contribution
 * segment is part of the published contract and names its own tone vocabulary,
 * so an Uplink's badge data still has to reach the scale.
 *
 * `neutral` folds to the floor so it can take part in a merge. A caller
 * rendering the entry should map `neutral` to NO severity instead, which draws
 * the decorative grey chip that a kind-tag wants (see `Panel`'s badge pills).
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

/** `StatusTone` -> `Severity`. Same folding as `BadgeEntry`'s over its own names. */
export function severityFromStatusTone(tone: StatusTone): Severity {
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

/**
 * `TextTone` -> `Severity`. `Text`'s tones (`accent`/`default`/`muted`/
 * `faint`) are display-emphasis tiers, not severity, so they all fold to the
 * nominal floor. The mapper exists only so a caller threading a value tone into
 * a severity slot compiles and is treated as non-alarming rather than breaking.
 */
export function severityFromTextTone(_tone: TextTone): Severity {
  return "nominal";
}
