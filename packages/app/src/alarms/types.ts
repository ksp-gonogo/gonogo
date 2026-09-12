export type AlarmState =
  /** Trigger condition not yet met. */
  | "pending"
  /** Time-based: UT is within the lead window, host has stepped warp down.
   *  Threshold-based: never used (no lead phase). */
  | "arming"
  /** Trigger condition just met: banner shows "FIRED", fade-out in a few seconds. */
  | "firing"
  /** Already-fired, kept briefly for visibility then removed. */
  | "fired";

export type ThresholdOp = ">" | ">=" | "<" | "<=" | "==" | "!=";

/**
 * Which clock an alarm's instant is on, and therefore who evaluates it.
 *
 * - `"command"`: the clock the operator is reading. The alarm fires when the
 *   VIEW time reaches it, which is one light-time after the craft passed it.
 *   Evaluated here, on the client, the way every alarm always has been.
 * - `"scet"`: the craft's own clock. The alarm fires when the GAME's time
 *   reaches it, and the mod stops the warp for everybody when it does.
 *   Evaluated on the mod, because a client holds only delayed readings.
 *
 * Absent means `"command"`, so every persisted alarm and every LAN session
 * keeps exactly the behaviour it had.
 */
export type AlarmVantage = "command" | "scet";

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
  /**
   * Which clock {@link ut} is on. See {@link AlarmVantage}.
   *
   * A SCET time alarm is not a nicety a client could fake by subtracting the
   * light-time itself. It would have to subtract it ONCE, when the operator set
   * the alarm, and the craft's light-time keeps moving: an alarm armed ten
   * minutes before a Duna apoapsis fires wrong by however far the geometry
   * drifted in those ten minutes. Armed on the mod it is right by construction,
   * because the comparison runs against the game's own clock every tick.
   */
  vantage?: AlarmVantage;
}

/**
 * Whether this trigger is armed on the craft's clock, and therefore owned by
 * the mod rather than by the client's own tick.
 *
 * Both arms that can carry a vantage answer here, and every caller that skips
 * client-side evaluation asks this rather than the trigger's kind: what the
 * client must not do is the same for a time arm and a threshold one, because
 * the reason is the same. The mod compares against the craft's true state
 * upstream of the reveal gate, and the client holds only readings a light-time
 * old.
 */
export function isScetTrigger(trigger: AlarmTrigger): boolean {
  return (
    (trigger.kind === "time" || trigger.kind === "threshold") &&
    trigger.vantage === "scet"
  );
}

export interface ThresholdTrigger {
  kind: "threshold";
  /** Data key to read (e.g. `v.altitude`, `v.surfaceVelocity`). */
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
  /**
   * Which clock the comparison is made on. See {@link AlarmVantage}.
   *
   * This is the arm that genuinely cannot be done anywhere else. A time alarm
   * only needs a clock and the client has one; "is the craft above 100 km NOW"
   * needs the craft's state now, which reaches the ground a light-time late and
   * by then is the answer to a different question.
   */
  vantage?: AlarmVantage;
  /**
   * SCET only: the Topic whose payload carries the value, as the wire spells a
   * Topic (`"vessel.flight"`).
   *
   * The flat {@link dataKey} cannot stand in for it. It is `topic + "." +
   * fieldPath` with nothing marking the join, and a Topic can have two segments
   * or three (`vessel.orbit.truth`), so splitting one back apart is a guess.
   * The simulation addresses a reading as a Topic and a path into its payload,
   * and this is that address carried rather than reconstructed.
   */
  topic?: string;
  /** SCET only: the dotted path into {@link topic}'s payload (`"altitudeAsl"`). */
  fieldPath?: string;
}

/**
 * The Topic-and-path address a SCET threshold is armed against, or null when
 * the trigger is not one or carries no address.
 *
 * Null is a real answer rather than an impossible state: a key that came from a
 * live `DataSource` rather than from the contract's own field catalogue has no
 * Topic behind it, so there is nothing for the simulation to resolve.
 */
export function scetThresholdAddress(
  trigger: AlarmTrigger,
): { topic: string; fieldPath: string } | null {
  if (trigger.kind !== "threshold" || trigger.vantage !== "scet") return null;
  const { topic, fieldPath } = trigger;
  if (!topic || !fieldPath) return null;
  return { topic, fieldPath };
}

export type ContractParameterTargetState = "Complete" | "Failed";

/**
 * Fires when a specific parameter on a specific contract reaches the
 * target state. Reads `contracts.active`; the parameter is identified
 * by its title (string-equal) within the contract whose `id` matches.
 *
 * The trigger ignores the underlying numeric value and works on a
 * discrete state transition: "Incomplete → Complete" is the canonical
 * use case ("ping me when this objective is met"). Picking a contract
 * that's no longer Active (e.g. the operator already accepted, or it
 * was cancelled) means the trigger sits perpetually pending; the host
 * doesn't auto-prune. Same shape as a parameterTitle-typo alarm,
 * fail safe rather than silently fire.
 */
export interface ContractParameterTrigger {
  kind: "contract-parameter";
  contractId: number;
  /** Parameter title as emitted on `contracts.active[].parameters[].title`. */
  parameterTitle: string;
  /** State the parameter must reach. Default "Complete". */
  targetState: ContractParameterTargetState;
  /** Sustain seconds: typically 0 since the state is already discrete. */
  sustainSeconds: number;
}

/**
 * Fires on the arrival of a discrete occurrence on an `event` stream topic
 * (the discrete-occurrence primitive: see `EventTimeline` in
 * `@ksp-gonogo/sitrep-client`). Unlike threshold / contract-parameter, which
 * are level-triggered (a condition that holds), an event trigger is
 * edge-triggered: it latches the moment a matching occurrence is *revealed*,
 * then fires and stays fired: an occurrence is a fact of the past, it never
 * "un-happens".
 *
 * Only occurrences revealed *after* the alarm begins watching count, so
 * creating an alarm never replays an event already in the buffer (mirrors
 * `useStreamEvent`, which skips the sticky replay). No `sustainSeconds`: a
 * discrete edge has nothing to sustain.
 *
 * Scaffold note: no producer topic is wired yet. The host reads revealed
 * occurrences through an injected reader on `AlarmStateMachine` that currently
 * defaults to empty: so an `event` alarm sits perpetually pending until a
 * producer is wired. Fail-safe, same posture as a typo'd contract-parameter.
 */
export interface EventTrigger {
  kind: "event";
  /** Event-stream topic id whose occurrences drive this alarm. */
  topic: string;
  /**
   * Optional occurrence-kind filter. When set, only occurrences whose `kind`
   * string-equals this fire the alarm; unset fires on any occurrence on the
   * topic.
   */
  eventKind?: string;
}

export type AlarmTrigger =
  | TimeTrigger
  | ThresholdTrigger
  | ContractParameterTrigger
  | EventTrigger;

/**
 * Side-effect to dispatch when the alarm fires. Currently action-group only:
 * the operator picks a group and the host resolves it to that group's own
 * command at fire time. Lives alongside the visual fire event so the central
 * alarm pipeline (warp dewarp ramp, cross-screen acknowledge) covers the
 * action-group dispatch automatically: see
 * `project_central_alarm_pipeline.md`.
 *
 * Discriminated union from the start so future trigger-style side
 * effects (kOS RUN, log-and-move-on, emit-peer-message etc.) can be
 * added without churning consumers.
 */
export type AlarmFireAction = {
  kind: "action-group";
  /**
   * Which group to fire, as `actionGroupIdOf` spells it: a stock singleton's
   * name (`"SAS"`, `"Stage"`) or `AG<index>` for a custom.
   *
   * The index rather than the name on the custom half, for the reason that
   * function's own doc gives: two AGX groups can share a display name, and a
   * player naming one "Stage" would otherwise resolve to the stock Stage and
   * drop a stage off the vessel.
   */
  action: string;
};

export interface Alarm {
  id: string;
  name: string;
  notes?: string;
  trigger: AlarmTrigger;
  state: AlarmState;
  /** Source of the alarm: "main" or a peer id. */
  createdBy: string;
  /** Wall-clock `Date.now()` when created. */
  createdAt: number;
  /**
   * Threshold alarms only: UT seconds when the condition first matched
   * in the current run. Reset to null whenever the condition becomes
   * false, so the sustain timer always measures contiguous match.
   */
  matchSinceUT?: number | null;
  /**
   * The UT at which the thing that fired this alarm actually HAPPENED, as
   * distinct from `matchSinceUT`, which is the UT it was revealed at. Under
   * signal delay the two are far apart, and "when did it happen" is the number
   * the operator wants; the reveal UT cannot stand in for it, and it has to
   * keep being the reveal UT because that is what opens the firing window.
   * Undefined until something latches.
   *
   * Set by the two arms whose firing instant is not the client's own clock:
   * an `event` trigger latches the occurrence's own UT, and a SCET time
   * trigger latches the instant the mod reported stopping the warp at. Both
   * are on the craft's clock, and both render with the SCET qualifier.
   */
  eventUT?: number;
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
  /** "HIGH" | "LOW": matches the wire's warp mode when known. */
  mode: "HIGH" | "LOW" | "UNKNOWN";
}

export interface AlarmSnapshot {
  alarms: Alarm[];
  /**
   * Latest KSP universal time we've observed on the wire, seconds.
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
   *
   * `targetRate` is what that rung runs at on THIS install, or null while
   * nothing has said. It rides the snapshot so a station never looks a rung up
   * in a ladder of its own: the rung numbers are shared, the rates behind them
   * belong to whichever game the host is connected to.
   */
  warpTo: {
    alarmId: string;
    targetIndex: number;
    targetRate: number | null;
  } | null;
  /**
   * Real-time buffer (seconds) the warp-to controller leaves between the
   * current rate and the alarm's lead window. Higher = more pessimistic /
   * earlier step-down. Configurable from the banner.
   *
   * The FLOOR, not the whole margin: on a delayed craft the controller uses
   * `max(this, owlt)`, because the operator's view is one light-time behind
   * and a warp window cannot be aborted from inside. See
   * `WarpControl.computeWarpToIndex`.
   */
  warpSafetyMarginSeconds: number;
  /**
   * One-way light time to the craft, seconds, when the controller is holding
   * open more room than the setting above asks for. Absent on a LAN session,
   * and absent from a snapshot minted by a host that predates it.
   *
   * Reported so the banner can say why the ladder is running slower than the
   * number in the operator's own box: a control that is silently overridden
   * reads as a broken control.
   */
  owltSeconds?: number;
  /**
   * Why the simulation would not arm a SCET alarm, keyed by alarm id, in the
   * mod's own words. Absent when nothing has been refused.
   *
   * The refusal is the ONLY way a client learns a Topic cannot be read
   * pre-reveal: what a SCET threshold may be armed against is a table inside
   * the mod and nothing publishes it, so the picker can offer a Topic the
   * simulation turns down. Carried on the snapshot so the row can say so,
   * rather than sitting armed-looking and never firing, which an operator
   * cannot tell apart from a condition that simply has not come due.
   */
  scetArmRefusals?: Record<string, string>;
}

export const DEFAULT_LEAD_SECONDS = 10;
export const DEFAULT_SUSTAIN_SECONDS = 0;
export const DEFAULT_WARP_SAFETY_MARGIN_SECONDS = 10;
export const MIN_WARP_SAFETY_MARGIN_SECONDS = 1;
export const MAX_WARP_SAFETY_MARGIN_SECONDS = 120;

/** Migrate v1 persisted alarms (top-level `ut` / `leadSeconds`) into the
 *  v2 `trigger` shape. Idempotent: already-v2 records pass through. */
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
          /* Anything that is not the literal "scet" is the command vantage,
             which is what every alarm persisted before the SCET arm existed
             is: the absent field has to mean the old behaviour or a reload
             silently re-aims somebody's alarm onto another clock. */
          vantage: t.vantage === "scet" ? "scet" : "command",
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
      /* A SCET threshold is only a SCET threshold if it carries the address the
         simulation resolves. Without one there is nothing to arm, and an alarm
         that can never be armed would sit pending forever with nothing on
         screen saying why; demoted to the command vantage it is at least the
         alarm the operator can watch working. Anything that is not the literal
         "scet" is the command vantage for the same reason the time arm gives:
         the absent field has to mean the behaviour every persisted alarm
         already had. */
      const topic = typeof t.topic === "string" ? t.topic : "";
      const fieldPath = typeof t.fieldPath === "string" ? t.fieldPath : "";
      const addressed = topic !== "" && fieldPath !== "";
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
          vantage: t.vantage === "scet" && addressed ? "scet" : "command",
          ...(addressed ? { topic, fieldPath } : {}),
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
    if (t.kind === "event" && typeof t.topic === "string") {
      return {
        id: r.id,
        name: r.name,
        notes,
        trigger: {
          kind: "event",
          topic: t.topic,
          eventKind: typeof t.eventKind === "string" ? t.eventKind : undefined,
        },
        state: state ?? "pending",
        createdBy,
        createdAt,
        matchSinceUT,
        eventUT: typeof r.eventUT === "number" ? r.eventUT : undefined,
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
