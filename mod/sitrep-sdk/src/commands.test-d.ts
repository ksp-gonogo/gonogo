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
import type { CommandArgs, CommandId, CommandReply } from "./commands";
import { type COMMAND_IDS, isCommandId } from "./commands";

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
