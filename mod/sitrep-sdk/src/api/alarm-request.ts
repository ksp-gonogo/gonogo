// ---------------------------------------------------------------------------
// The alarm REQUEST surface: how an Uplink asks the app to create an alarm.
//
// An Uplink never owns an alarm. Arming one directly over `alarm.scet.arm` is
// the shape that does not work, and it fails in a way nothing reports: the
// app's `ScetAlarmBridge` reconciles the mod's roster against the app's OWN
// alarm list every frame and disarms every id that list cannot account for, so
// an arm the app never made is dropped within a frame or two of being accepted.
//
// So the request goes the other way. The Uplink asks, the APP creates, and the
// resulting alarm is an ordinary one: it sits in the operator's list, the
// reconcile accounts for it because the app made it, and the operator can
// rename, retarget or delete it like any other. The same request works on a
// station, where it travels to the host the way a station's own add already
// does.
//
// Only the three trigger arms an Uplink can state honestly are published here.
// `contract-parameter` addresses stock career contracts, which is the app's
// vocabulary rather than an Uplink's, and publishing it would freeze an
// app-internal shape as third-party API for no reachable use.
// ---------------------------------------------------------------------------

import type { TopicId } from "../topics";
import { getHost } from "./host";
import type { UplinkClientHandle } from "./types";

/**
 * Which clock a threshold alarm is judged on, the command centre's or the
 * vessel's. Useful for letting an alarm fire when the operator learns of a
 * condition, or when the condition is true at the vessel. Set through the
 * `vantage` of {@link UplinkAlarmThresholdTrigger}:
 *
 * - `"command"`, the default when a threshold names no vantage: what the
 *   command centre this screen commands from has been told. A vessel's value
 *   reaches it one signal delay late, so the alarm stops time warp when the
 *   centre learns of the condition
 * - `"scet"`: the vessel's own clock. The alarm stops time warp when the
 *   condition is true at the vessel
 *
 * This is only what the request asks for. The alarm the mod then holds records
 * the place it is judged at as `ScetAlarm.vantage`, a `commandCentre.roster`
 * id such as `"ground:<name>"` or `"vessel:<guid>"`.
 *
 * The mod may refuse a `"scet"` threshold for a value it cannot read ahead of
 * the delay. The alarm's row then shows it as not armed with the mod's reason,
 * and it never fires. A time alarm takes no vantage.
 *
 * @category Alarms
 */
export type UplinkAlarmVantage = "command" | "scet";

/**
 * An alarm that fires at a fixed universal time. Useful for warning the
 * operator before a known event, such as a facility upgrade finishing. Used as
 * the `trigger` of an {@link UplinkAlarmRequest}.
 *
 * @category Alarms
 */
export interface UplinkAlarmTimeTrigger {
  /** Always `"time"`. */
  kind: "time";
  /** KSP universal time to fire at, seconds. */
  ut: number;
  /**
   * Seconds before `ut` to drop out of time warp, so the operator has time to
   * act. Omitted, Gonogo's default is used.
   */
  leadSeconds?: number;
}

/**
 * The comparison a threshold alarm makes between a Topic field and its value.
 * Used as the `op` of {@link UplinkAlarmThresholdTrigger}.
 *
 * @category Alarms
 */
export type UplinkAlarmThresholdOp = ">" | ">=" | "<" | "<=" | "==" | "!=";

/**
 * An alarm that fires while a numeric field of a Topic compares true against
 * `value`. The Topic and the path inside its payload are given separately.
 * Useful for warning the operator when a reading, such as altitude, crosses a
 * limit. Used as the `trigger` of an {@link UplinkAlarmRequest}.
 *
 * @category Alarms
 */
export interface UplinkAlarmThresholdTrigger {
  /** Always `"threshold"`. */
  kind: "threshold";
  /** The Topic carrying the value, e.g. `"vessel.flight"`. */
  topic: TopicId;
  /** Dotted path into that Topic's payload, e.g. `"altitudeAsl"`. */
  fieldPath: string;
  /** How the field is compared with `value`. */
  op: UplinkAlarmThresholdOp;
  /** The value to compare against, as a plain magnitude in the field's own unit. */
  value: number;
  /**
   * Seconds the condition must hold before firing, for gating a noisy signal.
   * 0 (the default) fires on the first match.
   */
  sustainSeconds?: number;
  /** See {@link UplinkAlarmVantage}. */
  vantage?: UplinkAlarmVantage;
}

/**
 * An alarm that fires at a universal time a Topic publishes, followed as it
 * moves: the mod reads `fieldPath` on every tick, drops the warp `leadSeconds`
 * before it and fires at it. Useful for an event whose time is recalculated,
 * such as a project in progress completing, because the alarm keeps up with the
 * change and works with nothing on screen. It is judged on the subject's own
 * clock, so it has no command-centre form. Used as the `trigger` of an
 * {@link UplinkAlarmRequest}.
 *
 * @category Alarms
 */
export interface UplinkAlarmInstantTrigger {
  /** Always `"instant"`. */
  kind: "instant";
  /** The Topic carrying the universal time, e.g. `"career.status"`. */
  topic: TopicId;
  /** Dotted path into that Topic's payload to the universal time. */
  fieldPath: string;
  /**
   * Seconds before the instant to drop out of time warp, so the operator has
   * time to act. Omitted, Gonogo's default is used.
   */
  leadSeconds?: number;
}

/**
 * When a requested alarm fires: at a time, when a value crosses a threshold, or
 * at a time a Topic publishes and keeps recalculating. Useful for telling the
 * operator's alarm list what to watch. Used as the `trigger` of an
 * {@link UplinkAlarmRequest}.
 *
 * @category Alarms
 */
export type UplinkAlarmTrigger =
  | UplinkAlarmTimeTrigger
  | UplinkAlarmThresholdTrigger
  | UplinkAlarmInstantTrigger;

/**
 * An alarm an Uplink asks Gonogo to create, with its key, name and trigger.
 * Useful for adding a warning to the operator's alarm list. Passed to the
 * function {@link useAlarmRequest} returns.
 *
 * @category Alarms
 */
export interface UplinkAlarmRequest {
  /**
   * Your Uplink's name for what the alarm is about, such as
   * `"facility-upgrade:LaunchPad"`. Other Uplinks' keys never clash with yours.
   * A request with a key you already have an alarm for updates that alarm
   * rather than adding another. If the operator deleted the alarm, the next
   * request with that key creates a new one.
   */
  key: string;
  /** The alarm's name, as the operator reads it. Name the event, not the Uplink. */
  name: string;
  /** An optional longer note, shown under the alarm's name in the operator's alarm list. */
  notes?: string;
  /** When the alarm fires: at a time, when a value crosses a threshold, or at a time a Topic publishes. See {@link UplinkAlarmTrigger}. */
  trigger: UplinkAlarmTrigger;
}

/**
 * Returns a function that asks Gonogo to add an alarm to the operator's alarm
 * list on behalf of your Uplink. Useful for letting a widget offer to warn the
 * operator, and drop out of time warp, before an event such as a facility
 * upgrade finishing. Pass the handle {@link defineUplinkClient} returned, so
 * the alarm records which Uplink asked for it. Where no alarm list is mounted,
 * such as outside the dashboard, the function does nothing.
 *
 * @example
 * ```tsx
 * import { defineUplinkClient, useAlarmRequest } from "@ksp-gonogo/sitrep-sdk";
 * import { Button } from "@ksp-gonogo/ui-kit";
 *
 * const MY_UPLINK = defineUplinkClient({
 *   id: "myuplink",
 *   version: "1.0.0",
 *   name: "My Uplink",
 *   description: "Reminds the operator when a facility upgrade finishes.",
 * });
 *
 * // finishesAtUt is a UT your widget already knows, such as one read from a Topic.
 * function RemindMe({ facility, finishesAtUt }: { facility: string; finishesAtUt: number }) {
 *   const requestAlarm = useAlarmRequest(MY_UPLINK);
 *   const remind = () =>
 *     requestAlarm({
 *       key: `facility-upgrade:${facility}`,
 *       name: `${facility} upgrade complete`,
 *       // Drop out of warp 60 s before the instant.
 *       trigger: { kind: "time", ut: finishesAtUt, leadSeconds: 60 },
 *     });
 *   return <Button onClick={remind}>Remind me</Button>;
 * }
 * ```
 *
 * @category Alarms
 */
export function useAlarmRequest(
  owner: UplinkClientHandle,
): (request: UplinkAlarmRequest) => void {
  // gonogo:reads none
  return getHost().useAlarmRequest(owner);
}
