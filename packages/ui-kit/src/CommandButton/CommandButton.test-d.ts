/**
 * Type-level proof that a command input speaks the handle's own types in both
 * directions: the reply it hands to `onConfirmed` and the args it dispatches.
 * Reading a field the reply does not have, or omitting a required argument, is
 * a compile error at the widget.
 */

import type { UseCommandResult } from "@ksp-gonogo/sitrep-sdk";
import type { CommandButtonHandle, CommandReplyLike } from "./commandControl";

type Equal<Left, Right> =
  (<Probe>() => Probe extends Left ? 1 : 2) extends <
    Probe,
  >() => Probe extends Right ? 1 : 2
    ? true
    : false;
type Expect<Condition extends true> = Condition;

interface Envelope {
  success: boolean;
  payload?: { replayed?: boolean };
}

declare const enveloped: UseCommandResult<unknown, Envelope>;

/** The handle's reply type reaches `onConfirmed`, not `unknown`. */
type _ConfirmedSeesTheReply = Expect<
  Equal<
    NonNullable<
      NonNullable<ReturnType<typeof enveloped.with>["options"]["onConfirmed"]>
    >,
    (reply: Envelope) => void
  >
>;

/** And it is inferred off `send`, so no call site names the type. */
type ReplyOf<Handle> =
  Handle extends CommandButtonHandle<infer Reply> ? Reply : never;
type _ReplyComesOffTheHandle = Expect<
  Equal<ReplyOf<CommandButtonHandle<Envelope>>, Envelope>
>;

/** A bare handle's reply is the envelope, not `unknown`, so a wrong reader cannot typecheck. */
type _DefaultsToTheEnvelope = Expect<
  Equal<ReplyOf<CommandButtonHandle>, CommandReplyLike>
>;

declare const bare: CommandButtonHandle;

/** The receipt a plan write actually carries, on `payload`. Nothing like the envelope around it. */
interface FlatReceipt {
  outcome: number;
  refusal: number;
}

async function _theHonestReaderIsWritable() {
  const reply = await bare.dangerouslySendWithoutInput();
  // Readable without a cast, because every command answers this.
  const succeeded: boolean = reply.success;
  // Still `unknown`: the bare handle does not know which command it is, so reaching a field means narrowing.
  const payload: unknown = reply.payload;
  return [succeeded, payload];
}

async function _theWrongCastIsAnError() {
  const reply = await bare.dangerouslySendWithoutInput();
  // @ts-expect-error the envelope is not the receipt it carries: this is the
  // exact conversion the seven controls above made, and `unknown` allowed it.
  const receipt = reply as FlatReceipt;
  return receipt;
}

/** A command's declared arguments, as the generated map resolves them. */
interface BurnArgs {
  burnIndex: number;
  profile: number;
}

declare const burnHandle: UseCommandResult<BurnArgs, CommandReplyLike>;

/** `with` takes the handle's own argument type, or a function returning it. */
type _ArgsComeOffTheHandle = Expect<
  Equal<
    Parameters<typeof burnHandle.with>[0],
    BurnArgs | (() => BurnArgs) | undefined
  >
>;

function _wrongArgsAreAnError() {
  // @ts-expect-error a required argument is missing; this dispatched for real
  return burnHandle.with({ burnIndex: 0 });
}

function _misspeltArgsAreAnError() {
  // @ts-expect-error `burnIndexx` is not an argument of this command
  return burnHandle.with({ burnIndexx: 0, profile: 1 });
}

/** A handle that says nothing about its args still takes anything. */
declare const untyped: UseCommandResult;
type _UntypedHandleKeepsTakingAnything = Expect<
  Equal<Parameters<typeof untyped.with>[0], unknown>
>;
