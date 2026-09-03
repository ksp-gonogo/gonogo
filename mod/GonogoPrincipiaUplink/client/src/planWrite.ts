import type { CommandReply, UseCommandResult } from "@ksp-gonogo/sitrep-sdk";
import type { PrincipiaPlanWriteReceipt } from "./__generated__/contract";
import {
  PrincipiaWriteOutcome,
  PrincipiaWriteRefusal,
} from "./__generated__/contract";

/**
 * Every command that changes a flight plan, as one union.
 *
 * <p>Named so the reply type below is derived from the whole family rather than
 * from whichever member was typed first: a command whose reply diverges from its
 * siblings makes this union stop collapsing, and the widgets that read a receipt
 * off it stop compiling.</p>
 */
export type PrincipiaPlanWriteCommand =
  | "principia.plan.arm"
  | "principia.plan.burn.insert"
  | "principia.plan.burn.remove"
  | "principia.plan.burn.replace"
  | "principia.plan.create"
  | "principia.plan.delete"
  | "principia.plan.duplicate"
  | "principia.plan.horizon"
  | "principia.plan.integrator"
  | "principia.plan.send";

/**
 * What a plan write RESOLVES with: the command envelope, whose `payload` is the
 * receipt.
 *
 * <p>The envelope and the receipt are two objects and the difference between
 * them is the whole of this file. Every widget here used to cast the envelope
 * straight to {@link PrincipiaPlanWriteReceipt} through an `unknown` parameter,
 * so `outcome`, `refusal` and `replayed` were read off a `CommandResult` that
 * has none of them and came back `undefined` on every write ever made. Nothing
 * complained: `unknown` accepts every reader, including a wrong one.</p>
 */
export type PrincipiaPlanWriteReply = CommandReply<PrincipiaPlanWriteCommand>;

/**
 * A plan-write handle passed DOWN to a subsection, keeping its reply type.
 *
 * <p>The subsections here took a bare `UseCommandResult`, whose reply defaults
 * to `unknown`, so a `useCommand("principia.plan.delete")` handed one row deep
 * arrived having forgotten what it answers with. That is the same hole as an
 * `unknown` `onConfirmed` and one prop annotation away from re-opening it: a
 * widget that types its control and not the prop it reaches it through has typed
 * nothing. Args stay open because the four commands take four different
 * argument types and no subsection reads them.</p>
 */
export type PrincipiaPlanWriteHandle = UseCommandResult<
  unknown,
  PrincipiaPlanWriteReply
>;

/**
 * The receipt inside a resolved plan write, or null when the reply carried
 * none.
 *
 * <p>Narrowed rather than cast. The payload crosses the wire as a dictionary,
 * because a core serializer may not reference an Uplink's assembly and this
 * Uplink's producer therefore flattens its own receipt (see `JsonWriter`'s
 * "producer owns the flatten" boundary). `outcome` and `refusal` are the
 * receipt's two REQUIRED fields, so a payload without both is not a receipt and
 * is reported as none rather than defaulted: both enums make zero the closed
 * answer, and a missing field read as zero would invent a refusal nobody
 * issued.</p>
 */
export function planWriteReceipt(
  reply: PrincipiaPlanWriteReply,
): PrincipiaPlanWriteReceipt | null {
  const payload: unknown = reply.payload;
  if (typeof payload !== "object" || payload === null) return null;
  const candidate = payload as Partial<PrincipiaPlanWriteReceipt>;
  if (
    typeof candidate.outcome !== "number" ||
    typeof candidate.refusal !== "number"
  ) {
    return null;
  }
  return candidate as PrincipiaPlanWriteReceipt;
}

/**
 * Whether a receipt says the plan was left exactly as it was.
 *
 * <p>Two ways it can say so, and a widget reading only one of them reports a
 * write that never happened. A REPLAY is the mod answering a repeated request id
 * out of its own store without calling the plugin, and it resolves like any
 * other success. An outcome that is not `Written` is the receipt refusing the
 * envelope around it, which the contract requires a reader to honour: "Nothing
 * here can render as a quiet success."</p>
 *
 * <p>Only the replay arm is reachable through the mod's current paths, because
 * every non-`Written` outcome is also answered with `Success = false` and
 * rejects before a receipt reader runs. It is read anyway because the receipt is
 * the authority on what happened and the envelope is not, and because that
 * pairing is the producer's choice rather than a property of the wire.</p>
 */
export function nothingWasWritten(
  receipt: PrincipiaPlanWriteReceipt | null,
): receipt is PrincipiaPlanWriteReceipt {
  if (receipt === null) return false;
  return (
    receipt.replayed === true ||
    receipt.outcome !== PrincipiaWriteOutcome.Written
  );
}

/**
 * The mod's own vocabulary for a write that did not land, or null when the
 * receipt reports one that did.
 *
 * <p>The enum members BY NAME, plus the producer's sentence where it wrote one.
 * This Uplink keeps no English table of Principia's guards: the name is what a
 * reader takes back to the mod's source, and inventing a sentence for each of
 * twenty-two refusals would be twenty-two chances to describe the wrong
 * one.</p>
 */
export function planWriteRefusalLine(
  receipt: PrincipiaPlanWriteReceipt,
): string | null {
  if (receipt.outcome === PrincipiaWriteOutcome.Written) return null;
  const outcome = PrincipiaWriteOutcome[receipt.outcome] ?? receipt.outcome;
  const refusal = PrincipiaWriteRefusal[receipt.refusal] ?? receipt.refusal;
  const detail = receipt.refusalDetail;
  const codes = `${outcome} / ${refusal}`;
  return detail ? `${codes}: ${detail}` : codes;
}
