// Type-level proof that `onConfirmed` speaks the handle's OWN reply type.
//
// It was `(result: unknown) => void`, which is the one signature that cannot be
// wrong: every reader typechecks, including a reader that treats the command
// ENVELOPE as the payload it wraps. Seven controls across one Uplink did exactly
// that, reading a write receipt's fields off the `CommandResult` that carries
// it, so all of them read `undefined` on every write and the "nothing was
// written" banner they exist to raise could not fire.
//
// The parameter is now inferred from `handle.send`, so a reader that reaches
// for a field the reply does not have is a compile error at the widget rather
// than a silent `undefined` at the operator.

import type { CommandButtonHandle, CommandButtonProps } from "./CommandButton";

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
 * A caller with nothing to say about the reply still writes nothing: the
 * parameter defaults to `unknown`, which is what every control that ignores
 * `onConfirmed` already had.
 */
type _DefaultsToUnknown = Expect<Equal<ReplyOf<CommandButtonHandle>, unknown>>;
