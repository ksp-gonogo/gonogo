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

export type ContractParameterTargetState = "Complete" | "Failed";

/**
 * Fires when a specific parameter on a specific contract reaches the
 * target state. Reads `contracts.active`; the parameter is identified
 * by its title (string-equal) within the contract whose `id` matches.
 *
 * The trigger ignores the underlying numeric value and works on a
 * discrete state transition — "Incomplete → Complete" is the canonical
 * use case ("ping me when this objective is met"). Picking a contract
 * that's no longer Active (e.g. the operator already accepted, or it
 * was cancelled) means the trigger sits perpetually pending; the host
 * doesn't auto-prune. Same shape as a parameterTitle-typo alarm —
 * fail safe rather than silently fire.
 */
export interface ContractParameterTrigger {
  kind: "contract-parameter";
  contractId: number;
  /** Parameter title as emitted on `contracts.active[].parameters[].title`. */
  parameterTitle: string;
  /** State the parameter must reach. Default "Complete". */
  targetState: ContractParameterTargetState;
  /** Sustain seconds — typically 0 since the state is already discrete. */
  sustainSeconds: number;
}

export type AlarmTrigger =
  | TimeTrigger
  | ThresholdTrigger
  | ContractParameterTrigger;

/**
 * Side-effect to dispatch when the alarm fires. Currently action-group
 * only — the operator picks an existing Telemachus action key (`f.ag1`,
 * `f.stage`, etc.) and the host calls `dataSource.execute()` at fire
 * time. Lives alongside the visual fire event so the central alarm
 * pipeline (warp dewarp ramp, cross-screen acknowledge) covers the
 * action-group dispatch automatically — see
 * `project_central_alarm_pipeline.md`.
 *
 * Discriminated union from the start so future trigger-style side
 * effects (kOS RUN, log-and-move-on, emit-peer-message etc.) can be
 * added without churning consumers.
 */
export type AlarmFireAction = {
  kind: "action-group";
  /** Telemachus action key, e.g. `f.ag1`, `f.abort`, `f.stage`. */
  action: string;
};

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
  /**
   * Optional side effects fired in order when the alarm transitions to
   * `firing`. Errors are swallowed at the host boundary so one failed
   * action doesn't block the alarm itself or the rest of the list.
   */
  onFire?: AlarmFireAction[];
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
  const onFire = parseOnFire(r.onFire);

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
        onFire,
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
        onFire,
      };
    }
    if (
      t.kind === "contract-parameter" &&
      typeof t.contractId === "number" &&
      typeof t.parameterTitle === "string"
    ) {
      const targetState = t.targetState === "Failed" ? "Failed" : "Complete";
      return {
        id: r.id,
        name: r.name,
        notes,
        trigger: {
          kind: "contract-parameter",
          contractId: t.contractId,
          parameterTitle: t.parameterTitle,
          targetState,
          sustainSeconds:
            typeof t.sustainSeconds === "number" ? t.sustainSeconds : 0,
        },
        state: state ?? "pending",
        createdBy,
        createdAt,
        matchSinceUT,
        onFire,
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
    onFire,
  };
}

function parseOnFire(raw: unknown): AlarmFireAction[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: AlarmFireAction[] = [];
  for (const item of raw) {
    if (
      item &&
      typeof item === "object" &&
      (item as { kind?: unknown }).kind === "action-group" &&
      typeof (item as { action?: unknown }).action === "string"
    ) {
      out.push({
        kind: "action-group",
        action: (item as { action: string }).action,
      });
    }
  }
  return out.length > 0 ? out : undefined;
}
