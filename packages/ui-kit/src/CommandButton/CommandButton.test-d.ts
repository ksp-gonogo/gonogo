/**
 * Type-level proof that this control speaks the handle's OWN types in both
 * directions: the reply it hands to `onConfirmed` and the args it dispatches.
 * Reading a field the reply does not have, or omitting a required argument, is
 * a compile error at the widget.
 */

import type {
  CommandButtonHandle,
  CommandButtonProps,
  CommandReplyLike,
} from "./CommandButton";

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

/** The handle's reply type reaches `onConfirmed`, not `unknown`. */
type _ConfirmedSeesTheReply = Expect<
  Equal<
    NonNullable<CommandButtonProps<Envelope>["onConfirmed"]>,
    (result: Envelope) => void
  >
>;

/** And it is INFERRED off `send`, so no call site names the type. */
type ReplyOf<Handle> =
  Handle extends CommandButtonHandle<infer Reply> ? Reply : never;
type _ReplyComesOffTheHandle = Expect<
  Equal<ReplyOf<CommandButtonHandle<Envelope>>, Envelope>
>;

/** A bare handle's reply is the ENVELOPE, not `unknown`, so a wrong reader cannot typecheck. */
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
  const reply = await bare.send();
  // Readable without a cast, because every command answers this.
  const succeeded: boolean = reply.success;
  // Still `unknown`: the bare handle does not know which command it is, so reaching a field means narrowing.
  const payload: unknown = reply.payload;
  return [succeeded, payload];
}

async function _theWrongCastIsAnError() {
  const reply = await bare.send();
  // @ts-expect-error the envelope is not the receipt it carries: this is the
  // exact conversion the seven controls above made, and `unknown` allowed it.
  const receipt = reply as FlatReceipt;
  return receipt;
}

// `args` is `NoInfer`, so a wrong args object cannot widen `Args` to its own shape.

/** A command's declared arguments, as the generated map resolves them. */
interface BurnArgs {
  burnIndex: number;
  profile: number;
}

declare const burnHandle: CommandButtonHandle<CommandReplyLike, BurnArgs>;

/** `args` is the handle's own argument type, inferred, with nothing written. */
type _ArgsComeOffTheHandle = Expect<
  Equal<
    CommandButtonProps<CommandReplyLike, BurnArgs>["args"],
    BurnArgs | undefined
  >
>;

function _wrongArgsAreAnError() {
  return {
    handle: burnHandle,
    label: "Apply",
    // @ts-expect-error a required argument is missing; this dispatched for real
    args: { burnIndex: 0 },
  } satisfies CommandButtonProps<CommandReplyLike, BurnArgs>;
}

function _misspeltArgsAreAnError() {
  return {
    handle: burnHandle,
    label: "Apply",
    // @ts-expect-error `burnIndexx` is not an argument of this command
    args: { burnIndexx: 0, profile: 1 },
  } satisfies CommandButtonProps<CommandReplyLike, BurnArgs>;
}

/** A handle that says nothing about its args still takes anything. */
type _UntypedHandleKeepsTakingAnything = Expect<
  Equal<CommandButtonProps["args"], unknown>
>;
