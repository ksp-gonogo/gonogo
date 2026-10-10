import type { LimitBreach } from "../__generated__/contract";
import { CommandErrorCode, FaultCode } from "../__generated__/error-codes";

/**
 * The markers a dispatch promise's rejection carries in `code` for the two
 * outcomes that are not a fault, defined here rather than at the throw site so
 * the published guard below and the spine that throws read ONE definition.
 * Every other rejection carries a `FaultCode`.
 */
export const COMMAND_REFUSED = "E_REFUSED";
/**
 * The rejection code of a command that was sent and never replied to. It may
 * have run, so sending it again may run it twice.
 *
 * @category Commands
 */
export const COMMAND_LOST = "E_LOST";

/**
 * Why a command's `send` rejected, as {@link classifyCommandRejection} returns
 * it. The three kinds match the {@link CommandStatus} phases of the same
 * names:
 *
 * - `refused`: the game received the command and said no. `errorCode` is the
 *   reason, and `reason` a more specific one where the mod gave it. Sending it
 *   again is refused again until something in the game changes, so show the
 *   reason
 * - `lost`: no reply arrived in time. The command may still have run, so
 *   sending it again may run it twice
 * - `failed`: something broke on the way, named by `code`, such as the link
 *   dropping or the mod's handler throwing. Sending it again may work
 *
 * @category Commands
 */
export type CommandRejection =
  | {
      /** The mod refused the command. */
      kind: "refused";
      /** Why it was refused. */
      errorCode: CommandErrorCode;
      /**
       * A more specific reason than `errorCode`, where the mod gave one.
       * `describeErrorCode` turns it into a sentence. An id this client does
       * not know is still a refusal of kind `errorCode`.
       */
      reason?: string;
      /** A sentence describing the refusal. */
      message: string;
      /**
       * The command id that was sent. With `args` and `label` it names what was
       * refused, as {@link commandRefusalSubject} does. All three may be
       * missing, such as on a refusal passed on from another screen.
       */
      command?: string;
      /** The arguments that were sent. */
      args?: unknown;
      /** The operator-facing description the command carried. */
      label?: string;
      /** The limit and the actual value behind the refusal, when the mod sent them. */
      breach?: LimitBreach;
      /** The refusal in the game's own words, when the game gave any. */
      detail?: string;
    }
  | {
      /** No reply came back, so the command may have run. */
      kind: "lost";
      /** A sentence describing the loss. */
      message: string;
    }
  | {
      /** The command failed. */
      kind: "failed";
      /** The fault code, or the error's own code. */
      code: FaultCode | (string & {});
      /** The error's message. */
      message: string;
    };

/**
 * Sorts the error a command's `send` rejected with into a
 * {@link CommandRejection}. Anything it does not recognise, including an
 * error thrown by your own code, is `failed`.
 *
 * @example
 * ```ts
 * async function fullThrottle(
 *   setThrottle: UseCommandResultFor<"vessel.control.setThrottle">,
 * ) {
 *   try {
 *     await setThrottle.send({ value: 1 });
 *   } catch (err) {
 *     const rejection = classifyCommandRejection(err);
 *     if (rejection.kind === "refused") console.warn(rejection.errorCode);
 *   }
 * }
 * ```
 *
 * @category Commands
 */
// Structural rather than instanceof, so it reads a bundled copy's error or one passed on from another screen.
export function classifyCommandRejection(err: unknown): CommandRejection {
  const carrier = (err ?? {}) as {
    code?: unknown;
    message?: unknown;
    errorCode?: unknown;
    reason?: unknown;
    command?: unknown;
    args?: unknown;
    label?: unknown;
    breach?: unknown;
    detail?: unknown;
  };
  const message =
    typeof carrier.message === "string" && carrier.message.length > 0
      ? carrier.message
      : String(err);

  if (carrier.code === COMMAND_REFUSED) {
    return {
      kind: "refused",
      // A refusal whose code did not survive is still a refusal, and modeUnavailable is a refusal with no reason given.
      errorCode:
        typeof carrier.errorCode === "string"
          ? (carrier.errorCode as CommandErrorCode)
          : CommandErrorCode.ModeUnavailable,
      reason:
        typeof carrier.reason === "string" && carrier.reason.length > 0
          ? carrier.reason
          : undefined,
      message,
      command:
        typeof carrier.command === "string" ? carrier.command : undefined,
      args: carrier.args,
      label: typeof carrier.label === "string" ? carrier.label : undefined,
      breach:
        typeof carrier.breach === "object" && carrier.breach !== null
          ? (carrier.breach as LimitBreach)
          : undefined,
      detail:
        typeof carrier.detail === "string" && carrier.detail.length > 0
          ? carrier.detail
          : undefined,
    };
  }
  if (carrier.code === COMMAND_LOST) return { kind: "lost", message };
  return {
    kind: "failed",
    code:
      typeof carrier.code === "string" ? carrier.code : FaultCode.Unclassified,
    message,
  };
}

/**
 * Title-cased, so a command id's verb reads as the start of a sentence.
 * `"upgrade"` -> `"Upgrade"`, and a camelCase segment splits on its humps
 * (`"setTarget"` -> `"Set Target"`) because the ids are written that way.
 */
function titleCaseSegment(segment: string): string {
  return segment
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

/** The first string the args carry, at the top level. Commands take one
 *  addressed thing (`applicantName`, `facilityId`, `nodeId`), so there is
 *  normally exactly one and no ordering question to get wrong. */
function firstStringArg(args: unknown): string | undefined {
  if (typeof args === "string") return args || undefined;
  if (typeof args !== "object" || args === null) return undefined;
  for (const value of Object.values(args as Record<string, unknown>)) {
    if (typeof value === "string" && value.length > 0) return value;
  }
  return undefined;
}

/**
 * Returns a name for a refused command, to start the sentence the operator
 * reads: `"Hire Valentina Kerman"`, `"Upgrade Launch Pad"`.
 *
 * The dispatch's own `label` is used when it has one. Otherwise the name is
 * the last segment of the command id, title-cased, followed by the first
 * string argument. A building is named as the game names it, where the
 * refusal's `breach` gives that name.
 *
 * Returns `""` when there is nothing to name it by.
 *
 * @category Commands
 */
export function commandRefusalSubject(refusal: {
  command?: string;
  args?: unknown;
  label?: string;
  breach?: LimitBreach;
}): string {
  if (refusal.label) return refusal.label;
  if (!refusal.command) return "";
  const segments = refusal.command.split(".").filter(Boolean);
  const verb = titleCaseSegment(segments[segments.length - 1] ?? "");
  const arg = firstStringArg(refusal.args);
  const object =
    arg !== undefined &&
    refusal.breach?.facility === arg &&
    refusal.breach.facilityName
      ? refusal.breach.facilityName
      : arg;
  return object ? `${verb} ${object}` : verb;
}
