export type AlarmState =
  /** Trigger condition not yet met. */
  | "pending"
  /** Time-based: UT is within the lead window — host has stepped warp down.
   *  Threshold-based: never used (no lead phase). */
  | "arming"
  /** Trigger condition just met — banner shows "FIRED", fade-out in a few seconds. */
  | "firing"
  /** Already-fired, kept briefly for visibility then removed. */
  | "fired";

export type ThresholdOp = ">" | ">=" | "<" | "<=" | "==" | "!=";

export interface TimeTrigger {
  kind: "time";
  /** KSP Universal Time at which the alarm fires, seconds. */
  ut: number;
  /**
   * Seconds before UT to step warp down. Default 10. Longer values give
   * the operator more time to pre-align; shorter ones minimise real-time
   * waste when timing isn't critical.
   */
  leadSeconds: number;
}

export interface ThresholdTrigger {
  kind: "threshold";
  /** Telemachus key to read (e.g. `v.altitude`, `v.surfaceVelocity`). */
  dataKey: string;
  /** Comparison operator. */
  op: ThresholdOp;
  /** Threshold value (numeric only in v1). */
  value: number;
  /**
   * Minimum seconds the condition must be sustained before firing. Lets
   * users gate noisy signals (e.g. altitude bobbing across a threshold).
   * 0 fires immediately on first match.
   */
  sustainSeconds: number;
}

export type AlarmTrigger = TimeTrigger | ThresholdTrigger;

export interface Alarm {
  id: string;
  name: string;
  notes?: string;
  trigger: AlarmTrigger;
  state: AlarmState;
  /** Source of the alarm — "main" or a peer id. */
  createdBy: string;
  /** Wall-clock `Date.now()` when created. */
  createdAt: number;
  /**
   * Threshold alarms only — UT seconds when the condition first matched
   * in the current run. Reset to null whenever the condition becomes
   * false, so the sustain timer always measures contiguous match.
   */
  matchSinceUT?: number | null;
}

export interface AlarmWarpState {
  /** KSP warp-rate index. 0 = realtime. */
  index: number;
  /** Numeric multiplier corresponding to the index. */
  rate: number;
  /** "HIGH" | "LOW" — matches Telemachus's t.warpMode when known. */
  mode: "HIGH" | "LOW" | "UNKNOWN";
}

export interface AlarmSnapshot {
  alarms: Alarm[];
  /**
   * Latest KSP universal time we've observed from Telemachus, seconds.
   * Stations use this to render the T-minus countdown against an
   * authoritative source without subscribing to t.universalTime themselves.
   */
  ut: number | null;
  warp: AlarmWarpState;
  /**
   * Non-null when warp is elevated and no alarm or recent user-initiated
   * warp-change explains it. `detectedAtUT` is the UT at detection, so the
   * banner can age it out. Cleared when warp returns to 0 or the user
   * explicitly acks.
   */
  unscheduledWarp: { index: number; detectedAtUT: number } | null;
  /**
   * Active "warp to next alarm" session. The host steps the warp ladder
   * up/down each tick so that game-time-remaining never falls below
   * `warpSafetyMarginSeconds` of real-time, guaranteeing the alarm's
   * arming window is reachable. Null when no session is active.
   */
  warpTo: { alarmId: string; targetIndex: number } | null;
  /**
   * Real-time buffer (seconds) the warp-to controller leaves between the
   * current rate and the alarm's lead window. Higher = more pessimistic /
   * earlier step-down. Configurable from the banner.
   */
  warpSafetyMarginSeconds: number;
}

export const DEFAULT_LEAD_SECONDS = 10;
export const DEFAULT_SUSTAIN_SECONDS = 0;
export const DEFAULT_WARP_SAFETY_MARGIN_SECONDS = 10;
export const MIN_WARP_SAFETY_MARGIN_SECONDS = 1;
export const MAX_WARP_SAFETY_MARGIN_SECONDS = 120;

/** Migrate v1 persisted alarms (top-level `ut` / `leadSeconds`) into the
 *  v2 `trigger` shape. Idempotent — already-v2 records pass through. */
export function migrateAlarm(raw: unknown): Alarm | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== "string" || typeof r.name !== "string") return null;
  const state = r.state as AlarmState | undefined;
  const createdBy = typeof r.createdBy === "string" ? r.createdBy : "main";
  const createdAt = typeof r.createdAt === "number" ? r.createdAt : Date.now();
  const notes = typeof r.notes === "string" ? r.notes : undefined;
  const matchSinceUT =
    typeof r.matchSinceUT === "number" ? r.matchSinceUT : null;

  if (r.trigger && typeof r.trigger === "object") {
    const t = r.trigger as Record<string, unknown>;
    if (t.kind === "time" && typeof t.ut === "number") {
      return {
        id: r.id,
        name: r.name,
        notes,
        trigger: {
          kind: "time",
          ut: t.ut,
          leadSeconds:
            typeof t.leadSeconds === "number"
              ? t.leadSeconds
              : DEFAULT_LEAD_SECONDS,
        },
        state: state ?? "pending",
        createdBy,
        createdAt,
      };
    }
    if (
      t.kind === "threshold" &&
      typeof t.dataKey === "string" &&
      typeof t.value === "number" &&
      typeof t.op === "string"
    ) {
      return {
        id: r.id,
        name: r.name,
        notes,
        trigger: {
          kind: "threshold",
          dataKey: t.dataKey,
          op: t.op as ThresholdOp,
          value: t.value,
          sustainSeconds:
            typeof t.sustainSeconds === "number"
              ? t.sustainSeconds
              : DEFAULT_SUSTAIN_SECONDS,
        },
        state: state ?? "pending",
        createdBy,
        createdAt,
        matchSinceUT,
      };
    }
    return null;
  }

  // Pre-v2: top-level ut + leadSeconds
  if (typeof r.ut !== "number") return null;
  return {
    id: r.id,
    name: r.name,
    notes,
    trigger: {
      kind: "time",
      ut: r.ut,
      leadSeconds:
        typeof r.leadSeconds === "number"
          ? r.leadSeconds
          : DEFAULT_LEAD_SECONDS,
    },
    state: state ?? "pending",
    createdBy,
    createdAt,
  };
}
