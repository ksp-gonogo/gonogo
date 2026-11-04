import type { CommandStatus } from "@ksp-gonogo/sitrep-sdk";
import type { InFlightCommandLike } from "../CommandDelay/toInFlightListItems";
import type { ReckoningMarking } from "../readingCurrency";

/**
 * What a control that represents a state shows of the command that sets it,
 * while the state it shows is not yet the one the command sets: `sent` until
 * the mod answers the press, `held` while the route has a command for the
 * control waiting at a relay, whichever screen of the command centre sent it,
 * and `modelled` once a command is predicted to have reached the craft with
 * its reply still on its way back, when the control shows the state the
 * command sets, marked modelled. Null otherwise: where a command is on its way
 * is the delay rail's to show.
 */
export type ToggleConfirmation = "held" | "sent" | "modelled";

/**
 * The state a toggle control reads from the vessel: a flag, a count (a stage
 * group reports one) or nothing yet, where nothing is a third state and not
 * off. Useful for showing the operator what a switch such as SAS or an action
 * group is set to, and for telling an unread switch from one that is off. Used
 * by {@link CommandToggle} and {@link CommandButton}.
 *
 * @category CommandButton
 */
export type ToggleState = boolean | number | null | undefined;

/**
 * The state variant of {@link CommandButton}: the control shows a state, and a
 * press sends the command that sets the opposite. Useful for a switch the
 * operator flips under signal delay, such as SAS or an action group. Taken by
 * the `toggle` prop of {@link CommandButton} and {@link useCommandButton}.
 *
 * @category CommandButton
 */
export interface CommandToggle<Args = unknown> {
  /** The state as the vessel last reported it, uncoerced: nothing yet is a third state, not off. */
  state: ToggleState;
  /** What the control is called in the sentences it speaks ("RCS sent, not yet received"). */
  name: string;
  /** The word the control shows for a state. */
  word: (shown: ToggleState) => string;
  /** Every word `word` can return, so the control keeps its size as the word changes. */
  words: readonly string[];
  /** The word shown in place of the state until the mod answers the press. Defaults to "SENT". */
  sentWord?: string;
  /** Which of the handle's in-flight rows are this control's, where one command serves several controls. Defaults to all of them. */
  rows?: (row: InFlightCommandLike) => boolean;
  /**
   * The args for a press that moves the control away from `base`, the state
   * the control shows (or, while an earlier press is outstanding, the state
   * that press asked for). Return undefined where there is nothing to send; null is a real argument, as for a command that takes none.
   */
  args: (base: ToggleState) => Args | undefined;
  /**
   * Why the control cannot be pressed now, such as a game that refuses it or a
   * vessel that cannot be flown. The control is drawn dark with this as its
   * tip, and a press sends nothing. Null or absent when it can be pressed.
   */
  unavailable?: string | null;
  /** The mark the state's own reading wears, when it is held or late, which the control shows beside its own. */
  marking?: ReckoningMarking | null;
}

/** The toggle's confirmation from its handle's status and in-flight rows. */
export function toggleConfirmationOf(
  sent: boolean,
  status: CommandStatus | undefined,
  rows: readonly InFlightCommandLike[],
): ToggleConfirmation | null {
  if (sent) return "sent";
  if (rows.some((row) => row.held === true)) return "held";
  // Each press inverts the toggle, so an odd number arrived and unanswered predicts the opposite state.
  // A press whose reply is back is no longer modelled, though its row stays until the readings show it.
  const answered =
    status === undefined ||
    status.phase === "in-flight" ||
    status.phase === "idle"
      ? null
      : status.requestId;
  const arrived = rows.filter(
    (row) =>
      row.id !== answered &&
      (row.predictedPhase === "awaiting-reply" || row.predictedPhase === "due"),
  ).length;
  return arrived % 2 === 1 ? "modelled" : null;
}

/** The state a toggle shows: the opposite of its reading while its confirmation is `modelled`. */
export function shownToggleState(
  reading: ToggleState,
  confirmation: ToggleConfirmation | null,
): ToggleState {
  return confirmation === "modelled" && typeof reading === "boolean"
    ? !reading
    : reading;
}

/**
 * Whether the latest press of a toggle is still outstanding: not yet answered
 * by the craft, or answered and not yet shown by the readings.
 */
export function pressOutstanding(
  status: CommandStatus | undefined,
  rows: readonly InFlightCommandLike[],
): boolean {
  if (status === undefined || status.phase === "idle") return false;
  if (status.phase === "in-flight") return true;
  return rows.some((row) => row.id === status.requestId);
}

/** The state a toggle's args ask for, or undefined for args that set no state. */
export function askedToggleValue(args: unknown): boolean | undefined {
  if (args === null || typeof args !== "object") return undefined;
  const asked =
    "state" in args ? args.state : "enabled" in args ? args.enabled : undefined;
  return typeof asked === "boolean" ? asked : undefined;
}

/** What a toggle is waiting on, as a sentence for its tooltip and for a screen reader. */
export function confirmationSentenceOf(
  name: string,
  confirmation: ToggleConfirmation | null,
): string | null {
  switch (confirmation) {
    case "held":
      return `${name} held until contact returns`;
    case "sent":
      return `${name} sent, not yet received`;
    case "modelled":
      return `${name} shown as predicted: the command should have reached the craft, and its reply is on its way back`;
    default:
      return null;
  }
}

/** The held or modelled mark for a toggle, joined with the mark its reading already wears; null when neither applies. */
export function toggleMarking(
  name: string,
  confirmation: ToggleConfirmation | null,
  existing: ReckoningMarking | null,
): ReckoningMarking | null {
  if (confirmation !== "held" && confirmation !== "modelled") return existing;
  const caption = confirmationSentenceOf(name, confirmation) ?? "";
  return {
    kind: confirmation,
    caption: existing === null ? caption : `${existing.caption}. ${caption}`,
  };
}
