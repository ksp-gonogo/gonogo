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
// vocabulary rather than an Uplink's, and `event` has no producer wired yet, so
// an alarm on one would sit pending for ever. Publishing either would freeze an
// app-internal shape as third-party API for no reachable use.
// ---------------------------------------------------------------------------

import type { TopicId } from "../topics";
import { getHost } from "./host";
import type { UplinkClientHandle } from "./types";

/**
 * Which clock a THRESHOLD's condition is judged on.
 *
 * - `"command"`: the command centre this screen commands from, judged against
 *   what that centre has been told. A craft reading reaches it one light-time
 *   behind the craft; the career balance reaches a ground centre as it changes.
 *   The simulation evaluates it, and the warp stops on the tick that centre
 *   learns the condition holds
 * - `"scet"`: the craft's own clock. The simulation evaluates it, and the warp
 *   stops on the tick that clock reaches the condition
 *
 * Absent means `"command"`.
 *
 * A time alarm takes no vantage. Its instant is a universal time, every clock
 * agrees on one, and there is nothing for a choice to select between.
 *
 * A `"scet"` threshold can be refused: what the simulation is able to read
 * pre-reveal is a table inside the mod, and it is not published anywhere a
 * caller could consult first. A refusal is not silent, the operator's row says
 * NOT ARMED and carries the mod's reason. A `"command"` threshold the simulation
 * refuses is judged by the app instead, on its own once-a-second tick.
 */
export type UplinkAlarmVantage = "command" | "scet";

/** Fires at a fixed universal time. */
export interface UplinkAlarmTimeTrigger {
  kind: "time";
  /** KSP universal time to fire at, seconds. */
  ut: number;
  /**
   * Seconds before {@link ut} to step the warp down, so the operator arrives
   * with time to act rather than at the instant itself. Defaults to the app's
   * own default when omitted.
   */
  leadSeconds?: number;
}

/** The comparison a threshold makes. */
export type UplinkAlarmThresholdOp = ">" | ">=" | "<" | "<=" | "==" | "!=";

/**
 * Fires while a numeric field on a Topic compares true.
 *
 * Addressed as a Topic and a path into its payload, never as one flat dotted
 * string: a Topic id can be two segments or three, so splitting a joined key
 * back apart is a guess, and an alarm armed against the wrong subject is
 * accepted and then never fires.
 */
export interface UplinkAlarmThresholdTrigger {
  kind: "threshold";
  /** The Topic carrying the value, e.g. `"vessel.flight"`. */
  topic: TopicId;
  /** Dotted path into that Topic's payload, e.g. `"altitudeAsl"`. */
  fieldPath: string;
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

export type UplinkAlarmTrigger =
  | UplinkAlarmTimeTrigger
  | UplinkAlarmThresholdTrigger;

/** What an Uplink asks the app to create. */
export interface UplinkAlarmRequest {
  /**
   * This Uplink's own name for the thing the alarm is about, e.g.
   * `"facility-upgrade:LaunchPad"`. Scoped to the requesting Uplink, so two
   * Uplinks may use the same string without colliding.
   *
   * It is what makes the request idempotent, and it is required for that
   * reason. One key is one alarm: asking again with a key the Uplink already
   * has an alarm for RETARGETS that alarm rather than adding a second, so a
   * button pressed twice, or a request re-issued after a reconnect, leaves the
   * operator with one row instead of a growing pile of near-duplicates.
   *
   * The operator stays in charge of the result. Deleting the alarm really
   * deletes it; a later request under the same key creates a fresh one, which
   * is the honest reading of pressing the button again.
   */
  key: string;
  /** The row's name, as the operator reads it. Keep it about the event, not the Uplink. */
  name: string;
  /** Optional longer note on the row. */
  notes?: string;
  trigger: UplinkAlarmTrigger;
}

/**
 * Ask the app to create an alarm on this Uplink's behalf.
 *
 * ```ts
 * const requestAlarm = useAlarmRequest(MY_UPLINK);
 * // in a click handler:
 * requestAlarm({
 *   key: `facility-upgrade:${id}`,
 *   name: `${facility} upgrade complete`,
 *   trigger: { kind: "time", ut: finishesAtUt },
 * });
 * ```
 *
 * The handle is the one `defineUplinkClient` returned, and it is a parameter
 * rather than something the request declares for itself: the alarm records who
 * asked for it, and provenance an author types by hand is provenance that can
 * name somebody else.
 *
 * Returns a no-op when no alarm surface is mounted (a probe harness, a widget
 * rendered outside the dashboard). A widget that wants to hide the affordance
 * in that case should hide it on its own condition rather than probing this:
 * an alarm request is a thing to offer wherever the widget renders.
 */
export function useAlarmRequest(
  owner: UplinkClientHandle,
): (request: UplinkAlarmRequest) => void {
  return getHost().useAlarmRequest(owner);
}
