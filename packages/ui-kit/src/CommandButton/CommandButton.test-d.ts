// Type-level proof that this control speaks the handle's OWN types, in both
// directions: the reply it hands to `onConfirmed` and the args it dispatches.
//
// `onConfirmed` was `(result: unknown) => void`, which is the one signature that
// cannot be wrong: every reader typechecks, including a reader that treats the
// command ENVELOPE as the payload it wraps. Seven controls across one Uplink did
// exactly that, reading a write receipt's fields off the `CommandResult` that
// carries it, so all of them read `undefined` on every write and the "nothing
// was written" banner they exist to raise could not fire.
//
// `args` was `unknown` on the same interface and had never been checked on any
// dispatch this control has ever made. Both are now inferred off `handle.send`,
// so a reader reaching for a field the reply does not have, and a dispatch
// omitting a required argument, are compile errors at the widget rather than a
// silent `undefined` at the operator.

import type {
  CommandButtonHandle,
  CommandButtonProps,
  CommandReplyLike,
} from "./CommandButton";

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
    ? true
    : false;
type Expect<T extends true> = T;

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

/**
 * And it is INFERRED, so no call site has to name the type. A handle typed from
 * the generated command map carries its reply on `send`, and that is the whole
 * of the declaration a caller writes.
 */
type ReplyOf<H> = H extends CommandButtonHandle<infer R> ? R : never;
type _ReplyComesOffTheHandle = Expect<
  Equal<ReplyOf<CommandButtonHandle<Envelope>>, Envelope>
>;

/**
 * A caller with nothing to say about the reply gets the ENVELOPE, not
 * `unknown`.
 *
 * This is the half a per-widget annotation could not reach. Typing the control
 * bought nothing at the twenty-one bare `CommandButtonHandle` props in this
 * repo's own widget library, because the parameter defaulted to `unknown` and
 * `unknown` accepts every reader including a wrong one. The default is now the
 * one thing that is true of a reply before you know which command produced it:
 * the result envelope, with the command's own value on `payload` and nothing
 * else readable.
 */
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
  // Readable, because every command answers this. Under the old `unknown`
  // default this line was TS18046 and a widget had to cast to say anything at
  // all, which is how the wrong cast got written.
  const succeeded: boolean = reply.success;
  // The command's own value, still `unknown`: the bare handle does not know
  // which command it is, so reaching a field means narrowing first.
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

// ── The ARGS half ────────────────────────────────────────────────────────────
//
// The same hole in the other direction, and it was wider: `args` was `unknown`
// on both the handle and the props, so EVERY dispatch this control has ever made
// passed its arguments unchecked, whether or not the handle was typed. A typed
// reply and an untyped args is half a guarantee.
//
// `args` sits in `NoInfer` deliberately. It is the second inference site for the
// same parameter, so without it a wrong `args` object simply WIDENS `TArgs` to
// its own shape and agrees with itself; the handle is then the only source and
// the object is checked against it.

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

/** A handle that says nothing about its args still takes anything, as before. */
type _UntypedHandleKeepsTakingAnything = Expect<
  Equal<CommandButtonProps["args"], unknown>
>;
