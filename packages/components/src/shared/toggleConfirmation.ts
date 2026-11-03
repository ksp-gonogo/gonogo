import type { InFlightCommand } from "@ksp-gonogo/sitrep-sdk";
import type { ReckoningMarking } from "@ksp-gonogo/ui-kit";

/**
 * Where the latest toggle sent from a control stands while the state it shows
 * is not yet the one it set: `held` while the route has it waiting at a relay
 * for a link, `sent` while it travels, `unconfirmed` once its confirmation is
 * overdue. Null when nothing sent is outstanding.
 */
export type ToggleConfirmation = "held" | "sent" | "unconfirmed";

/**
 * The word a toggle button shows in place of its state while a confirmation is
 * outstanding. A held command shows no word: the button keeps its state and
 * wears the kit's held mark instead, see {@link heldCommandMarking}.
 */
export const CONFIRMATION_WORDS: Record<
  Exclude<ToggleConfirmation, "held">,
  string
> = {
  sent: "SENT",
  unconfirmed: "LATE",
};

/** Every confirmation word, for sizing a button so it keeps its size as the word changes. */
export const ALL_CONFIRMATION_WORDS: readonly string[] =
  Object.values(CONFIRMATION_WORDS);

/** The word a toggle button shows for a confirmation, or null where it keeps its state. */
export function confirmationWordOf(
  confirmation: ToggleConfirmation | null,
): string | null {
  return confirmation === null || confirmation === "held"
    ? null
    : CONFIRMATION_WORDS[confirmation];
}

/**
 * The kit's held mark for a toggle whose command waits at a relay, joined with
 * the mark the toggle already wears for a withheld or late reading. Null when
 * neither applies.
 */
export function heldCommandMarking(
  label: string,
  confirmation: ToggleConfirmation | null,
  existing: ReckoningMarking | null,
): ReckoningMarking | null {
  if (confirmation !== "held") return existing;
  const caption = confirmationSentenceOf(label, confirmation) ?? "";
  return {
    kind: "held",
    caption: existing === null ? caption : `${existing.caption}. ${caption}`,
  };
}

/** The confirmation of the latest dispatch in `inFlight`; a lost one shows nothing, the delay rail reports it. */
export function toggleConfirmationOf(
  inFlight: readonly InFlightCommand[],
): ToggleConfirmation | null {
  const latest = inFlight.at(-1);
  if (latest === undefined || latest.predictedPhase === "lost") return null;
  if (latest.predictedPhase === "overdue") return "unconfirmed";
  return latest.held === true ? "held" : "sent";
}

/** What a toggle is waiting on, as a sentence for its tooltip and for a screen reader. */
export function confirmationSentenceOf(
  label: string,
  confirmation: ToggleConfirmation | null,
): string | null {
  switch (confirmation) {
    case "held":
      return `${label} held until contact returns`;
    case "sent":
      return `${label} sent, until the craft's readings show it`;
    case "unconfirmed":
      return `${label} not yet shown in the craft's readings`;
    default:
      return null;
  }
}

/** Whether `value` is the state a toggle sent with `args` set; a toggle that sets no state has nothing to wait for. */
export function showsToggle(args: unknown, value: unknown): boolean {
  if (args === null || typeof args !== "object") return true;
  if ("state" in args) return value === args.state;
  if ("enabled" in args) return value === args.enabled;
  return true;
}

/** The state a toggle's args ask for, or undefined for args that set no state. */
export function askedToggleValue(args: unknown): boolean | undefined {
  if (args === null || typeof args !== "object") return undefined;
  const asked =
    "state" in args ? args.state : "enabled" in args ? args.enabled : undefined;
  return typeof asked === "boolean" ? asked : undefined;
}
