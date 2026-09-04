// Compile-time proof that the command registry TYPES a dispatch, checked by
// `tsc -p tsconfig.test-d.json` rather than by vitest: every assertion here is a
// type relation, and a runtime test cannot see one.
//
// It exists because the failure this whole registry replaces was invisible at
// runtime. `send: (args?: unknown) => Promise<unknown>` accepted every object
// and answered every shape, so a wrong args key and a misread reply both
// typechecked clean and broke in the game. The assertions below are the ones
// that would have failed.

import type {
  CommandResult,
  CommandResultOf,
  RepairOutcome,
  SetEnabledArgs,
  SetThrottleArgs,
  VantagePlanReply,
} from "./__generated__/contract";
import type {
  AnyCommandReply,
  CommandArgs,
  CommandId,
  CommandReply,
} from "./commands";
import { type COMMAND_IDS, isCommandId } from "./commands";
import type {
  UseCommandResult,
  UseCommandResultFor,
} from "./spine/use-command";

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
    ? true
    : false;
type AssertTrue<T extends true> = T;

// One args shape serving several commands still resolves per command.
export type _SetSasArgs = AssertTrue<
  Equal<CommandArgs<"vessel.control.setSas">, SetEnabledArgs>
>;
export type _SetGearArgs = AssertTrue<
  Equal<CommandArgs<"vessel.control.setGear">, SetEnabledArgs>
>;
export type _ThrottleArgs = AssertTrue<
  Equal<CommandArgs<"vessel.control.setThrottle">, SetThrottleArgs>
>;

// The three reply shapes: bare, payload-carrying, and the one command that does
// not answer a CommandResult at all.
export type _PlainReply = AssertTrue<
  Equal<CommandReply<"vessel.control.setSas">, CommandResult>
>;
export type _PayloadReply = AssertTrue<
  Equal<CommandReply<"vessel.control.stage">, CommandResultOf<number>>
>;
export type _TypedPayloadReply = AssertTrue<
  Equal<CommandReply<"vessel.repair">, CommandResultOf<RepairOutcome>>
>;
export type _NonResultReply = AssertTrue<
  Equal<CommandReply<"vessel.trajectory.forVantage">, VantagePlanReply>
>;

// The union is closed over the generated ids, so a command that was never
// declared is not a `CommandId` and `useCommand`'s typed overload cannot take
// it. This is the assertion that makes the escape hatch a choice rather than
// the only path.
export type _UnknownIsNotACommand = AssertTrue<
  "vessel.control.setSaas" extends CommandId ? false : true
>;

// The runtime array and the type union are the same set, in both directions.
// The compile invariants in `./commands.ts` prove it for the SDK-owned half;
// this proves the array's ELEMENT type is usable as a `CommandId` at a call
// site, which is what an author iterating the vocabulary actually does.
export type _IdsAreCommandIds = AssertTrue<
  (typeof COMMAND_IDS)[number] extends CommandId ? true : false
>;

// The guard narrows, so a string off the wire reaches the typed surface.
export function _narrows(value: string): CommandId | null {
  return isCommandId(value) ? value : null;
}

// ── The floor a handle keeps when it does not know which command it holds ─────
//
// The half a per-widget annotation could never reach. `UseCommandResult` bare,
// which is what a prop passing a handle a row deep is usually declared as, used
// to default its reply to `unknown`, and `unknown` accepts every reader
// including one that treats the envelope AS the payload it wraps. Seven
// controls in one Uplink read a write receipt's fields off the `CommandResult`
// carrying it and got `undefined` on every write ever made, with nothing
// complaining.

/** The reply is the envelope, not `unknown`, when nobody named a command. */
export type _BareHandleKeepsTheEnvelope = AssertTrue<
  Equal<Awaited<ReturnType<UseCommandResult["send"]>>, AnyCommandReply>
>;

/** And a NAMED command still overrules it: the floor never widens a known reply. */
export type _NamedCommandBeatsTheFloor = AssertTrue<
  Equal<
    Awaited<ReturnType<UseCommandResultFor<"vessel.control.stage">["send"]>>,
    CommandResultOf<number>
  >
>;

declare const bare: UseCommandResult;

async function _theHonestReaderIsWritable() {
  const reply = await bare.send();
  // Readable, because every command answers this. Under `unknown` it was
  // TS18046 and a widget had to cast to say anything at all, which is how the
  // wrong cast got written.
  const succeeded: boolean = reply.success;
  // The command's own value, still `unknown`: reaching a field means narrowing.
  const payload: unknown = reply.payload;
  return [succeeded, payload];
}

/** A receipt as a producer flattens it onto `payload`. Nothing like the envelope. */
interface FlatReceipt {
  outcome: number;
  refusal: number;
}

async function _theWrongCastIsAnError() {
  const reply = await bare.send();
  // @ts-expect-error the envelope is not the receipt it carries
  return reply as FlatReceipt;
}

/**
 * A typed handle is still assignable to the bare one, which is what every
 * delay-rail control depends on. The floor would be useless if flooring it cost
 * that.
 */
export type _TypedHandleStillFitsTheBareOne = AssertTrue<
  UseCommandResultFor<"vessel.control.setSas"> extends UseCommandResult
    ? true
    : false
>;
