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
// Only the two trigger arms an Uplink can state honestly are published here.
// `contract-parameter` addresses stock career contracts, which is the app's
// vocabulary rather than an Uplink's, and publishing it would freeze an
// app-internal shape as third-party API for no reachable use.
// ---------------------------------------------------------------------------

import type { TopicId } from "../topics";
import { getHost } from "./host";
import type { UplinkClientHandle } from "./types";

/**
 * Which clock a threshold alarm is judged on:
 *
 * - `"command"`, the default: what the command centre this screen commands
 *   from has been told. A craft's value reaches it one signal delay late, so
 *   the alarm stops time warp when the centre learns of the condition
 * - `"scet"`: the craft's own clock. The alarm stops time warp when the
 *   condition is true at the craft
 *
 * The mod may refuse a `"scet"` threshold for a value it cannot read ahead of
 * the delay. The alarm's row then shows it as not armed with the mod's reason,
 * and it never fires. A time alarm takes no vantage.
 *
 * @category Alarms
 */
export type UplinkAlarmVantage = "command" | "scet";

/**
 * Fires at a fixed universal time.
 *
 * @category Alarms
 */
export interface UplinkAlarmTimeTrigger {
  /** Always `"time"`. */
  kind: "time";
  /** KSP universal time to fire at, seconds. */
  ut: number;
  /**
   * Seconds before `ut` to drop out of time warp, so the player has time to
   * act. Omitted, Gonogo's default is used.
   */
  leadSeconds?: number;
}

/**
 * The comparison a threshold makes.
 *
 * @category Alarms
 */
export type UplinkAlarmThresholdOp = ">" | ">=" | "<" | "<=" | "==" | "!=";

/**
 * Fires while a numeric field of a Topic compares true against `value`. The
 * Topic and the path inside its payload are given separately.
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
 * When a requested alarm fires: at a time, or when a value crosses a threshold.
 *
 * @category Alarms
 */
export type UplinkAlarmTrigger =
  | UplinkAlarmTimeTrigger
  | UplinkAlarmThresholdTrigger;

/**
 * An alarm an Uplink asks Gonogo to create, through {@link useAlarmRequest}.
 *
 * @category Alarms
 */
export interface UplinkAlarmRequest {
  /**
   * Your Uplink's name for what the alarm is about, such as
   * `"facility-upgrade:LaunchPad"`. Other Uplinks' keys never clash with yours.
   * A request with a key you already have an alarm for updates that alarm
   * rather than adding another. If the player deleted the alarm, the next
   * request with that key creates a new one.
   */
  key: string;
  /** The alarm's name, as the player reads it. Name the event, not the Uplink. */
  name: string;
  /** Optional longer note on the row. */
  notes?: string;
  /** When the alarm fires. */
  trigger: UplinkAlarmTrigger;
}

/**
 * Returns a function that asks Gonogo to create an alarm for your Uplink. Pass
 * the handle {@link defineUplinkClient} returned, so the alarm records which
 * Uplink asked for it. Where no alarm list is mounted, such as outside the
 * dashboard, the function does nothing.
 *
 * @example
 * ```tsx
 * const MY_UPLINK = defineUplinkClient({ id: "myuplink", version: "1.0.0", name: "My Uplink" });
 *
 * function RemindMe({ facility, finishesAtUt }: { facility: string; finishesAtUt: number }) {
 *   const requestAlarm = useAlarmRequest(MY_UPLINK);
 *   const remind = () =>
 *     requestAlarm({
 *       key: `facility-upgrade:${facility}`,
 *       name: `${facility} upgrade complete`,
 *       trigger: { kind: "time", ut: finishesAtUt },
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
