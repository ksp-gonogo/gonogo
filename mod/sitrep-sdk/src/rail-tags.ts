/**
 * What a delay-rail entry IS, on three axes, read off the contract instead of
 * assumed.
 *
 * The rail draws several kinds of thing crossing the same gap, and for a long
 * time it could only draw one of them: a command, a point in time, waiting for
 * an ack. Everything else was emulated. Voice was a ribbon because a widget put
 * it in the `ribbons` array; fly-by-wire was continuous because one command id
 * sat in a hardcoded `Set`, and then because that same id sat in a declaration
 * saying the same thing; nothing had ever said `direction` or `delivery` out
 * loud at all. This file is the vocabulary, and the three derivations that fill
 * it in from what the mod already declares and from what a producer knows.
 *
 * | direction | continuity | delivery         | a real example                  |
 * |-----------|------------|------------------|---------------------------------|
 * | command   | discrete   | acked            | staging, an action group        |
 * | command   | continuous | acked            | fly-by-wire, ack = the readback |
 * | telemetry | continuous | fire-and-forget  | radio voice                     |
 * | telemetry | discrete   | fire-and-forget  | a science result sent home      |
 *
 * The axes are orthogonal, and each drives exactly ONE visual property in the
 * kit that draws them (`@ksp-gonogo/ui-kit`'s `railTags.ts`, where the accessors
 * and the renderer table live). Which combinations have a renderer is a
 * question for that file, not this one: an entry can be perfectly well declared
 * here and have nothing yet able to draw it, and saying so out loud is the point
 * of separating the two.
 *
 * **Where each axis comes from, and why it is not a list in this package:**
 *
 * - DIRECTION is the caller's own question, and it is not a judgement call: a
 *   declared command id is a command, and anything else on the rail is
 *   telemetry. The two namespaces are disjoint (asserted in
 *   `rail-tags.test.ts`), and a producer always knows which it holds, so the
 *   axis is set by which derivation you reach for rather than by a lookup that
 *   could go either way
 * - DELIVERY comes off the generated rail table's `replies`, which codegen
 *   fills in from whether the command replies. Telemetry has no reply channel
 *   at all, so nothing replies to a push
 * - CONTINUITY is a property of the PRODUCER, and each of the three derivations
 *   below reads it from what the producer is doing rather than from a
 *   declaration. One dispatch of a command is a point, always: what is a span is
 *   the AXIS a widget holds, which is {@link railTagsForControlAxis}, or the
 *   stream a producer is pushing, which is {@link railTagsForTelemetry}. The
 *   command's own id cannot say which, because the same id is both depending on
 *   whether the operator pressed it or is holding it
 */

import { commandRail } from "./commands";

/**
 * Which way an entry on the delay rail travels: a `"command"` goes out to the
 * craft, `"telemetry"` comes back from it. Sets the direction of the mark and
 * its colour.
 *
 * @category Commands
 */
export type RailDirection = "command" | "telemetry";

/**
 * Whether an entry on the delay rail is a single moment or a span of time. A
 * `"discrete"` entry is drawn as a dot travelling the rail, a `"continuous"`
 * one as a ribbon along it.
 *
 * @category Commands
 */
export type RailContinuity = "discrete" | "continuous";

/**
 * Whether anything replies to an entry on the delay rail. An `"acked"` entry is
 * drawn with a return leg for its reply; a `"fire-and-forget"` one ends when it
 * reaches the far end.
 *
 * @category Commands
 */
export type RailDelivery = "acked" | "fire-and-forget";

/**
 * How a command or Topic travels on the delay rail: which way, as single
 * messages or continuously, and whether anything replies. `<CommandDelay>`
 * chooses how to draw an entry from these.
 *
 * | direction | continuity | delivery | example |
 * | --- | --- | --- | --- |
 * | command | discrete | acked | staging, an action group |
 * | command | continuous | acked | fly-by-wire, acknowledged by the craft's readback |
 * | telemetry | continuous | fire-and-forget | radio voice |
 * | telemetry | discrete | fire-and-forget | a science result sent home |
 *
 * @category Commands
 */
export interface RailTags {
  /** Whether the entry is a command going out or telemetry coming in. */
  direction: RailDirection;
  /** Whether it is a discrete event or a continuous flow. */
  continuity: RailContinuity;
  /** Whether an answer comes back (`acked`) or nothing does (`fire-and-forget`). */
  delivery: RailDelivery;
}

/**
 * How one command travels, as an Uplink's generated command map declares it.
 * Pass an entry from that map to {@link registerUplinkCommand}.
 *
 * @category Commands
 */
export interface CommandRail {
  /** Whether the command sends a reply. */
  readonly replies: boolean;

  /**
   * Whether the mod holds this command for the signal delay before running
   * it. A command that is not delayed runs as soon as it arrives, and no
   * countdown is shown for it.
   */
  readonly delayed: boolean;

  /**
   * The name of the argument holding the UT this command acts at, when it has
   * one. `send` refuses the command before it leaves when it would reach the
   * craft at or after that UT.
   */
  readonly arriveBefore?: string;
}

/**
 * One instance per combination, frozen, handed back to every caller that asks
 * for it.
 *
 * INTERNED rather than minted per call, and that is not a micro-optimisation.
 * These triples end up as fields on values that are compared by shallow
 * equality: a command handle is a fresh object literal on most renders, and the
 * delay rail's store only notifies its subscribers when a registered handle
 * actually moved. A freshly-built `tags` object would make every handle look
 * moved on every render, so the rail would re-render at the widget's frame rate
 * to draw the same thing. `useControlStream` has the same exposure through its
 * own `useMemo` dependencies.
 *
 * Fixing it here rather than asking each caller to memoise: there are eight
 * possible values, they never change, and a caller that forgot would produce a
 * performance regression with no visible symptom.
 */
const INTERNED = new Map<string, RailTags>();

function railTags(
  direction: RailDirection,
  continuity: RailContinuity,
  delivery: RailDelivery,
): RailTags {
  const key = `${direction}/${continuity}/${delivery}`;
  const held = INTERNED.get(key);
  if (held) return held;
  const minted = Object.freeze({ direction, continuity, delivery });
  INTERNED.set(key, minted);
  return minted;
}

/**
 * The tags of a command nothing has declared: a command whose id is built at
 * runtime, or one from an Uplink whose client has not loaded. It is a single
 * command that gets a reply, since every command replies.
 *
 * @category Commands
 */
export const UNDECLARED_COMMAND_RAIL_TAGS: RailTags = railTags(
  "command",
  "discrete",
  "acked",
);

/**
 * Returns the tags for a command from its {@link CommandRail}: a single
 * command, acked when it replies.
 *
 * @category Commands
 */
export function railTagsFromCommandRail(rail: CommandRail): RailTags {
  return railTags(
    "command",
    "discrete",
    rail.replies ? "acked" : "fire-and-forget",
  );
}

/**
 * Returns the tags for one press of a command, from what its mod or Uplink
 * declared, or {@link UNDECLARED_COMMAND_RAIL_TAGS} when nothing has declared
 * it.
 *
 * @category Commands
 */
export function railTagsForCommand(command: string): RailTags {
  const rail = commandRail(command);
  return rail === null
    ? UNDECLARED_COMMAND_RAIL_TAGS
    : railTagsFromCommandRail(rail);
}

/**
 * Returns the tags for a control the operator holds, such as pitch or
 * throttle, sent as a stream of settings and echoed back by the craft.
 * `writeCommand` is the command that sets it.
 *
 * The result is continuous, unlike {@link railTagsForCommand}, because what
 * crosses the delay is the held control rather than one press. Whether it is
 * acked comes from the command.
 *
 * @category Commands
 */
export function railTagsForControlAxis(writeCommand: string): RailTags {
  const command = railTagsForCommand(writeCommand);
  return railTags(command.direction, "continuous", command.delivery);
}

/**
 * Returns the tags for data coming back from a craft, such as a radio
 * transmission or a science result. It is always fire-and-forget, since nothing
 * replies to telemetry. Pass `"continuous"` for a stream such as an open
 * microphone, and `"discrete"` for a single result.
 *
 * @category Commands
 */
export function railTagsForTelemetry(continuity: RailContinuity): RailTags {
  return railTags("telemetry", continuity, "fire-and-forget");
}
