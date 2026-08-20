import { CommandErrorCode } from "../__generated__/contract";

/**
 * The rejection codes a dispatch promise can carry, defined here rather than at
 * the throw site so the published guard below and the spine that throws read
 * ONE definition. The spine is unpublished, so an author who had to match these
 * strings would be matching something they could only have learned from our
 * source.
 */
export const COMMAND_REFUSED = "E_REFUSED";
export const COMMAND_LOST = "E_LOST";

/**
 * Why a dispatch promise rejected, in the same three words the command's
 * `CommandStatus` phase uses, because they are the same three outcomes:
 *
 * - `refused`: the handler ran, the game evaluated it, and the answer was no.
 *   Carries the mod's typed `CommandErrorCode`. A retry changes nothing until
 *   the situation does, so the honest UI is a reason, not a try-again
 * - `lost`: no answer arrived by the predicted deadline. Nothing was decided
 *   and the command may well have executed anyway, so re-sending can double it
 * - `failed`: the machinery broke (a handler threw, a result would not
 *   serialize, the link went down mid-flight). A retry may genuinely work
 */
export type CommandRejection =
  | { kind: "refused"; errorCode: CommandErrorCode; message: string }
  | { kind: "lost"; message: string }
  | { kind: "failed"; code: string; message: string };

/**
 * Sort a caught dispatch rejection into one of the three outcomes above.
 *
 * Structural on purpose: it reads the `code` an ordinary `Error` carries rather
 * than requiring `instanceof` against a class from an unpublished namespace, so
 * it keeps working across a bundled copy, a peer-relayed rejection rehydrated
 * on a station, and a foreign throw from inside a handler. Anything it cannot
 * place is `failed`, which is the safe default: it is the outcome that says
 * "something broke, a retry may work" rather than inventing a game reason.
 */
export function classifyCommandRejection(err: unknown): CommandRejection {
  const carrier = (err ?? {}) as {
    code?: unknown;
    message?: unknown;
    errorCode?: unknown;
  };
  const message =
    typeof carrier.message === "string" && carrier.message.length > 0
      ? carrier.message
      : String(err);

  if (carrier.code === COMMAND_REFUSED) {
    return {
      kind: "refused",
      // A refusal whose reason did not survive is still a refusal. Reporting
      // `Unknown` keeps the outcome true where guessing at the reason would
      // not, and `Unknown` is a real member of the mod's own enum.
      errorCode:
        typeof carrier.errorCode === "number"
          ? (carrier.errorCode as CommandErrorCode)
          : CommandErrorCode.Unknown,
      message,
    };
  }
  if (carrier.code === COMMAND_LOST) return { kind: "lost", message };
  return {
    kind: "failed",
    code: typeof carrier.code === "string" ? carrier.code : "E_UNKNOWN",
    message,
  };
}
