import type { PathConnectedDuring, PendingEntry } from "@ksp-gonogo/sitrep-sdk";
import { controlChannelIds, getControlChannel } from "@ksp-gonogo/sitrep-sdk";

/**
 * Optimistic expectations: what we ASKED a control to be, beside what we last
 * saw it be, and never fused into it.
 *
 * ## Why this is not a `Reading` arm
 *
 * A commanded state is not a forward model of anything, so it does not belong
 * in `Reading<T>`, and three things about that type say so structurally rather
 * than as a matter of taste:
 *
 * - `useTelemetry` returns the WHOLE topic payload, so reckoning a commanded
 *   `sasMode` would mean constructing a whole `VesselControl` and handing the
 *   caller fifteen other stale facts to express one expectation
 * - a command echo is not a forward model of anything, which is why
 *   `vessel.control` is declared in `NEVER_RECKONABLE`. That used to be argued
 *   from mechanism instead: `readingFrom` returned `observed` before it
 *   consulted a reckoner, so a command-echo reckoner was unreachable in the live
 *   case, which is exactly when an operator presses the button. It now consults
 *   the reckoner on a live reading too, so the mechanism no longer makes the
 *   point and the declaration is what does
 * - a `Reading` is sampled at the delayed, scrubbable `viewUt`, while the
 *   pending queue is real-time command-centre bookkeeping. Folding them puts
 *   two clocks inside the one type whose stated purpose is that a frame has
 *   ONE view time
 *
 * So this is its own channel, composed beside a reading rather than inside it,
 * the same way `Certainty` stays on its own channel.
 *
 * ## Never a state, and never a denial either
 *
 * An expectation asserts nothing about the craft. It says what was sent and
 * when the reply is due, and the render's job is to mark the control out from
 * its siblings rather than to show it switched.
 *
 * It does not assert the opposite either, and that is the correction worth
 * writing down. Silence is not evidence: `Courier.DispatchCommand` checks
 * reachability ONCE, at dispatch, and `ScheduleCommand` then runs the handler
 * and the response with no re-check, so a command sent one tick before a
 * blackout still executes and it is the REPLY that is lost. Since contact is
 * usually lost after dispatch rather than before it, "no ack means it did not
 * happen" would be wrong more often than right in the case it was written for.
 *
 * Hence two distinct failure states rather than one:
 *
 * - `unconfirmed`: the reply is overdue and we cannot say either way. The
 *   default, and the honest answer to silence
 * - `lost`: the path demonstrably broke across the in-flight window, which is
 *   evidence of absence rather than absence of evidence. `classifyRetained`
 *   already draws this line and this reuses its predicate
 */
export type ExpectationPhase =
  /** Outbound: not yet at the craft. */
  | "in-transit"
  /** At the craft by now; the reply is not yet due. */
  | "awaiting-echo"
  /** The reply is overdue. We cannot say whether it happened. */
  | "unconfirmed"
  /** An observation from after arrival agrees. Ends the expectation. */
  | "confirmed"
  /** An observation from after arrival disagrees. Ends the expectation. */
  | "contradicted"
  /** The comms path broke across the in-flight window. Evidence, not silence. */
  | "lost";

export interface ControlExpectation {
  /** The dispatch's correlation id, so a renderer can key on one command. */
  id: string;
  /** The declared channel this command writes, e.g. `vessel.control.sasMode`. */
  channelId: string;
  /** The topic whose field carries the confirmed readback. */
  readTopic: string;
  /** The field on that payload. A renderer scopes to one control with this. */
  readField: string;
  /** What was asked for. Absent when the dispatch carried no scalar. */
  expected: number | undefined;
  dispatchedAt: number;
  /** UT the command reaches the craft: `dispatchedAt + oneWay`. */
  reachUt: number;
  /** UT the echo is due back: `dispatchedAt + 2 * oneWay`. */
  echoDueUt: number;
  phase: ExpectationPhase;
}

/**
 * An observation of the field an expectation is about: the value, and the UT it
 * was valid at. `undefined` when nothing has been observed.
 */
export interface FieldObservation {
  value: number | undefined;
  asOfUt: number;
}

export interface DeriveExpectationsArgs {
  entries: readonly PendingEntry[];
  /** Real-time command-centre clock, NOT a frame's view time: see this file's doc. */
  nowUt: number;
  /**
   * The last observation of a channel's read field, by channel id. A caller
   * supplies only the channels it renders.
   */
  observed?: Readonly<Record<string, FieldObservation | undefined>>;
  /** Seconds past `echoDueUt` before an overdue reply reads as unconfirmed. */
  overdueMarginSeconds?: number;
  /** `classifyRetained`'s predicate: did the path hold across the window? */
  pathConnectedDuring?: PathConnectedDuring;
  /** Tolerance for comparing a commanded value against its readback. */
  epsilon?: number;
}

const DEFAULT_OVERDUE_MARGIN_SECONDS = 3;
/**
 * A commanded axis is a float that has been through a round trip, so an exact
 * comparison would read every echo as a contradiction. A switch and an enum
 * ordinal are integers and sit far outside this.
 */
const DEFAULT_EPSILON = 1e-6;

/**
 * Turn the pending queue into expectations, one per in-flight control-channel
 * dispatch.
 *
 * Pure, and deliberately so: statefulness (own-dispatch memory, judder
 * latching) lives one layer up in the hooks, exactly as `command-delay.ts`
 * arranges it.
 *
 * A pending entry whose command is not a declared control channel yields
 * nothing: there is no read field to set an expectation against, so a stage
 * command or a maneuver removal belongs on the command-lifecycle chip and not
 * here.
 */
export function deriveExpectations({
  entries,
  nowUt,
  observed = {},
  overdueMarginSeconds = DEFAULT_OVERDUE_MARGIN_SECONDS,
  pathConnectedDuring,
  epsilon = DEFAULT_EPSILON,
}: DeriveExpectationsArgs): ControlExpectation[] {
  const out: ControlExpectation[] = [];
  for (const entry of entries) {
    const channel = channelForCommand(entry.command);
    if (!channel) continue;

    const dispatchedAt = entry.dispatchedAt.magnitude;
    const oneWay = entry.oneWaySeconds.magnitude;
    const reachUt = dispatchedAt + oneWay;
    const echoDueUt = dispatchedAt + 2 * oneWay;
    const expected = entry.commandedValue;

    out.push({
      id: entry.id,
      channelId: channel.id,
      readTopic: channel.readTopic,
      readField: channel.readField,
      expected,
      dispatchedAt,
      reachUt,
      echoDueUt,
      phase: phaseFor({
        nowUt,
        reachUt,
        echoDueUt,
        dispatchedAt,
        expected,
        observation: observed[channel.id],
        overdueMarginSeconds,
        pathConnectedDuring,
        epsilon,
      }),
    });
  }
  return out;
}

function phaseFor({
  nowUt,
  reachUt,
  echoDueUt,
  dispatchedAt,
  expected,
  observation,
  overdueMarginSeconds,
  pathConnectedDuring,
  epsilon,
}: {
  nowUt: number;
  reachUt: number;
  echoDueUt: number;
  dispatchedAt: number;
  expected: number | undefined;
  observation: FieldObservation | undefined;
  overdueMarginSeconds: number;
  pathConnectedDuring: PathConnectedDuring | undefined;
  epsilon: number;
}): ExpectationPhase {
  // An observation only settles anything if it was taken AFTER the command
  // could have arrived. Under delay the client keeps receiving samples stamped
  // before that for a full one-way period, so comparing against the newest
  // sample outright would collapse every expectation on its very next frame.
  // This is the amendment that matters most: the trigger is the sample's UT
  // against arrival, never "an observation arrived".
  if (observation?.value !== undefined && observation.asOfUt > reachUt) {
    return expected !== undefined &&
      Math.abs(observation.value - expected) <= epsilon
      ? "confirmed"
      : "contradicted";
  }

  // Evidence of absence outranks waiting: if the path demonstrably broke across
  // the window, the command's fate is known to be unknowable rather than
  // merely undecided yet.
  if (pathConnectedDuring && !pathConnectedDuring(dispatchedAt, echoDueUt)) {
    return "lost";
  }

  if (nowUt < reachUt) return "in-transit";
  if (nowUt <= echoDueUt + overdueMarginSeconds) return "awaiting-echo";
  return "unconfirmed";
}

/**
 * The declared channel a write command belongs to, or nothing.
 *
 * Resolved by scanning the generated table rather than indexing it, because the
 * table is keyed by CHANNEL id and a command is what the queue carries. Six
 * fly-by-wire axes share one command, so the first match wins and the axes are
 * left to `ControlDelayStream`, which already draws all six as tracks and is a
 * better surface for a continuous control than a per-axis expectation.
 */
function channelForCommand(command: string) {
  // Read through the SDK's accessor rather than a module-scope snapshot: the
  // generated table is static, and calling it here keeps this module dependent
  // on the SDK's stable surface instead of its codegen output's shape.
  for (const id of controlChannelIds()) {
    const channel = getControlChannel(id);
    if (channel?.writeCommand === command) return channel;
  }
  return undefined;
}
