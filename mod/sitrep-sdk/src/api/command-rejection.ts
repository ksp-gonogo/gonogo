import { CommandErrorCode, type LimitBreach } from "../__generated__/contract";

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
  | {
      kind: "refused";
      errorCode: CommandErrorCode;
      message: string;
      /**
       * What was dispatched, so the outcome can be SAID rather than only
       * classified: "Upgrade Launch Pad refused: ..." instead of
       * "command refused: ModeUnavailable". Optional because a rejection
       * rehydrated across a peer hop, or thrown by something other than this
       * spine, may not carry them, and the classification is still true
       * without them.
       */
      command?: string;
      args?: unknown;
      label?: string;
      /** The limit and the actual behind the reason, when the mod sent one. */
      breach?: LimitBreach;
      /** The refusal in the GAME's own words, when the game had any to give. */
      detail?: string;
    }
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
      // A refusal whose reason did not survive is still a refusal. Reporting
      // `Unknown` keeps the outcome true where guessing at the reason would
      // not, and `Unknown` is a real member of the mod's own enum.
      errorCode:
        typeof carrier.errorCode === "number"
          ? (carrier.errorCode as CommandErrorCode)
          : CommandErrorCode.Unknown,
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
    code: typeof carrier.code === "string" ? carrier.code : "E_UNKNOWN",
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
 * What a refused command is CALLED, for the front of the sentence an operator
 * reads: `"Hire Valentina Kerman"`, `"Upgrade Launch Pad"`.
 *
 * A dispatch's own `label` wins outright when it has one, since that is a
 * human saying what they meant. Otherwise the name is derived from what was
 * dispatched, and the derivation is general rather than a table of commands:
 * the id's LAST segment is the verb (this contract's ids are
 * `domain.noun.verb`), and the object is the one thing the args address.
 *
 * A facility id is the exception worth handling, because
 * `"LaunchPad"` is not what the building is called. When the breach names the
 * same facility the args do, its game-supplied display name is used instead.
 * That mapping lives on the wire precisely so no client has to keep an English
 * table of KSP's enum, which would be wrong in every other language.
 *
 * Returns `""` when there is nothing to go on, and a caller that gets one
 * should say the general thing rather than print an empty subject.
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
