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
 *   telemetry. The two namespaces are disjoint (asserted in `rail-tags.test.ts`),
 *   and a producer always knows which it holds, so the axis is answered by which
 *   derivation you reach for rather than by a lookup that could go either way
 * - DELIVERY comes off the generated rail table's `replies`, which codegen fills
 *   in from what the command answers. Telemetry has no reply channel at all, so
 *   nothing answers a push
 * - CONTINUITY is a property of the PRODUCER, and each of the three derivations
 *   below answers it from what the producer is doing rather than from a
 *   declaration. One dispatch of a command is a point, always: what is a span is
 *   the AXIS a widget holds, which is {@link railTagsForControlAxis}, or the
 *   stream a producer is pushing, which is {@link railTagsForTelemetry}. The
 *   command's own id cannot say which, because the same id is both depending on
 *   whether the operator pressed it or is holding it
 */

import { commandRail } from "./commands";

/** Who is talking to whom. Drives the entry's flow direction and its tone. */
export type RailDirection = "command" | "telemetry";

/**
 * Whether the entry is a point in time or a span of it. Drives the MARK: a
 * discrete entry is a dot travelling the rail, a continuous one is a ribbon
 * lying along it.
 */
export type RailContinuity = "discrete" | "continuous";

/**
 * Whether anything answers. Drives whether a RETURN LEG is drawn at all: a
 * fire-and-forget entry reaches the far end and simply ends, and drawing it a
 * return leg would be the lie this vocabulary exists to remove.
 */
export type RailDelivery = "acked" | "fire-and-forget";

export interface RailTags {
  direction: RailDirection;
  continuity: RailContinuity;
  delivery: RailDelivery;
}

/**
 * The one rail fact about one command that is not structural, as the generated
 * command map emits it. Declared structurally here rather than imported from
 * that map so an Uplink can hand over a row out of its OWN generated one, which
 * is a different declaration of the same shape.
 */
export interface CommandRail {
  readonly replies: boolean;
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
 * What the contract guarantees about a command NOBODY declared: an id reaching
 * `useCommand`'s untyped overload, a dynamic dispatch, an Uplink whose client
 * has not loaded yet.
 *
 * Discrete because one dispatch of any command is a point, and ACKED because
 * `Sitrep.Contract/CommandResult.cs` rules that results are always delivered,
 * never a fire-and-forget void, and that holds for a command this package has
 * never heard of just as much as for one it has. Reading an absent row as
 * `replies: false` instead would drop the return leg for every ordinary command
 * dispatched by name, which is the opposite of the truth.
 *
 * So this is what EVERY declared command reads as too, unless something other
 * than the command says otherwise. It stays its own name because the two
 * statements are different: this one is about an id nothing has declared.
 */
export const UNDECLARED_COMMAND_RAIL_TAGS: RailTags = railTags(
  "command",
  "discrete",
  "acked",
);

/**
 * One command's declared rail row turned into the three axes.
 *
 * Split from {@link railTagsForCommand} so the derivation can be exercised on a
 * row that does not exist yet: every command the contract declares today
 * answers something, so `replies: false` is unreachable through the lookup, and
 * a derivation whose other branch nothing can reach is a derivation nobody has
 * checked.
 */
export function railTagsFromCommandRail(rail: CommandRail): RailTags {
  return railTags(
    "command",
    "discrete",
    rail.replies ? "acked" : "fire-and-forget",
  );
}

/**
 * The three axes for a command, from what its owning assembly declared. Falls
 * back to {@link UNDECLARED_COMMAND_RAIL_TAGS} for a command no generated map
 * carries.
 */
export function railTagsForCommand(command: string): RailTags {
  const rail = commandRail(command);
  return rail === null
    ? UNDECLARED_COMMAND_RAIL_TAGS
    : railTagsFromCommandRail(rail);
}

/**
 * The three axes for a HELD CONTROL AXIS: a value the operator keeps their hand
 * on, dispatched as a coalesced stream of absolute sets and echoed back by the
 * craft.
 *
 * CONTINUITY is `continuous` here and nowhere else on the command side, because
 * what crosses the gap is the axis, not one press of it. One dispatch of the
 * write command is a point whichever axis it drives, `vessel.control.setAxes`
 * included: the Navball presses that same id to send a trim and gets a queue
 * row, and holds it to fly and gets a strip. Those are two entries about one
 * command, which is why the command cannot be the thing that says.
 *
 * This is the same argument {@link railTagsForTelemetry} makes for a microphone,
 * and it is the reason continuity is declared at the producer at all: the thing
 * that knows whether a value is being held is whatever is holding it.
 *
 * DELIVERY still comes off the command, because whether an ack comes back is
 * the command's business either way.
 */
export function railTagsForControlAxis(writeCommand: string): RailTags {
  const command = railTagsForCommand(writeCommand);
  return railTags(command.direction, "continuous", command.delivery);
}

/**
 * The three axes for something arriving rather than being ordered: a
 * transmission, a science result, a downlinked frame.
 *
 * Two of the three are intrinsic. DIRECTION is telemetry by construction, and
 * DELIVERY is fire-and-forget because a topic has no reply type: the contract
 * gives a command somewhere to answer and gives a push nowhere at all, so an
 * ack is not a thing that could arrive. CONTINUITY is the one the producer has
 * to state, and it is the same argument the command side makes: an open
 * microphone is a span, a science result is an event, and the difference is a
 * property of what is producing the data rather than of the rail.
 */
export function railTagsForTelemetry(continuity: RailContinuity): RailTags {
  return railTags("telemetry", continuity, "fire-and-forget");
}
