import { classifyCommandRejection, FaultCode } from "@ksp-gonogo/sitrep-sdk";
import {
  type CommandLossLike,
  commandFailedSentence,
  commandLossSentence,
  commandRefusalSentence,
  commandUndeliveredSentence,
} from "@ksp-gonogo/ui-kit";

/**
 * What the operator is told about one node command that did not confirm, in
 * the kit's outcome sentences: a refusal in the game's words, a command with
 * no reply as one that may have run, one that never left as safe to re-send,
 * and only a broken dispatch as failed.
 */
export function describeNodeRejection(
  err: unknown,
  dispatch: CommandLossLike,
): string {
  const rejection = classifyCommandRejection(err);
  if (rejection.kind === "refused") {
    return commandRefusalSentence({
      ...dispatch,
      errorCode: rejection.errorCode,
      reason: rejection.reason,
      breach: rejection.breach,
      detail: rejection.detail,
    });
  }
  if (rejection.kind === "lost") return commandLossSentence(dispatch);
  if (rejection.code === FaultCode.Undelivered) {
    return commandUndeliveredSentence(dispatch);
  }
  return commandFailedSentence(dispatch);
}

/**
 * What to tell the operator when a multi-burn plan stops part-way through: the
 * burns before it are confirmed in KSP, so that comes first, then what became
 * of the burn it stopped at, named by its place in the plan.
 */
export function describePartialDispatch(args: {
  /** Burns confirmed before the one that stopped the plan. */
  confirmed: number;
  /** Burns in the whole plan. */
  total: number;
  /** The rejection the stopping burn's command settled with. */
  err: unknown;
  /** What was dispatched for the stopping burn. */
  dispatch: CommandLossLike;
}): string {
  const { confirmed, total, err, dispatch } = args;
  // A single-burn plan has nothing to count, so its command speaks for itself.
  if (total <= 1) return describeNodeRejection(err, dispatch);
  const outcome = describeNodeRejection(err, {
    ...dispatch,
    label: `Burn ${confirmed + 1}`,
  });
  return `${confirmed} of ${total} burns confirmed. ${outcome}`;
}
