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
 * by {@link CommandToggle} and {@link Button}.
 *
 * @category CommandButton
 */
export type ToggleState = boolean | number | null | undefined;

/**
 * The state variant of {@link Button}: the control shows a state, and a
 * press sends the command that sets the opposite. Useful for a switch the
 * operator flips under signal delay, such as SAS or an action group. Taken by
 * the `toggle` prop of {@link Button} and {@link useCommandControl}.
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
   * What an arrived command does to a state its args do not set outright, as a
   * stage command lowers the stage count. Without it only args carrying a
   * `state` or `enabled` flag are modelled.
   */
  modelled?: (state: ToggleState, args: unknown) => ToggleState;
  /**
   * Why the control cannot be pressed now, such as a game that refuses it or a
   * vessel that cannot be flown. The control is drawn dark with this as its
   * tip, and a press sends nothing. Null or absent when it can be pressed.
   */
  unavailable?: string | null;
  /** The mark the state's own reading wears, when it is held or late, which the control shows beside its own. */
  marking?: ReckoningMarking | null;
}

/** The rows of a toggle's command predicted to have reached the craft with their reply still on the way back, in the order they arrive. */
function arrivedRows(
  status: CommandStatus | undefined,
  rows: readonly InFlightCommandLike[],
): InFlightCommandLike[] {
  // A press whose reply is back is no longer modelled, though its row stays until the readings show it.
  const answered =
    status === undefined ||
    status.phase === "in-flight" ||
    status.phase === "idle"
      ? null
      : status.requestId;
  const arrivalOf = (row: InFlightCommandLike) =>
    (row.dispatchedAt ?? 0) + (row.oneWaySeconds ?? 0);
  return rows
    .filter(
      (row) =>
        row.id !== answered &&
        (row.predictedPhase === "awaiting-reply" ||
          row.predictedPhase === "due"),
    )
    .sort((a, b) => arrivalOf(a) - arrivalOf(b));
}

/**
 * The state the craft is expected to be in once every arrived command has run,
 * applied in arrival order to the state last received, or undefined where no
 * arrived command sets a state. A command carries its value in its args; one
 * with none known (another screen's, whose args do not cross the wire) is read
 * as a flip of the running state.
 */
export function modelledToggleState(
  reading: ToggleState,
  status: CommandStatus | undefined,
  rows: readonly InFlightCommandLike[],
  apply?: (state: ToggleState, args: unknown) => ToggleState,
): ToggleState | undefined {
  let state = reading;
  let known = false;
  for (const row of arrivedRows(status, rows)) {
    // Another screen's args do not cross the wire, so its press can only be read as a flip of the running state.
    if (row.args === undefined) {
      if (typeof state === "boolean") {
        state = !state;
        known = true;
      }
      continue;
    }
    const asked = askedToggleValue(row.args);
    const next = asked !== undefined ? asked : apply?.(state, row.args);
    if (next === undefined) continue;
    known = true;
    state = next;
  }
  return known ? state : undefined;
}

/** The toggle's confirmation from its handle's status and in-flight rows. */
export function toggleConfirmationOf(
  sent: boolean,
  status: CommandStatus | undefined,
  rows: readonly InFlightCommandLike[],
  reading: ToggleState = undefined,
  apply?: (state: ToggleState, args: unknown) => ToggleState,
): ToggleConfirmation | null {
  if (sent) return "sent";
  if (rows.some((row) => row.held === true)) return "held";
  return modelledToggleState(reading, status, rows, apply) === undefined
    ? null
    : "modelled";
}

/** The state a toggle shows: the state its arrived commands set, in arrival order, while its confirmation is `modelled`. */
export function shownToggleState(
  reading: ToggleState,
  confirmation: ToggleConfirmation | null,
  status?: CommandStatus,
  rows: readonly InFlightCommandLike[] = [],
  apply?: (state: ToggleState, args: unknown) => ToggleState,
): ToggleState {
  if (confirmation !== "modelled") return reading;
  return modelledToggleState(reading, status, rows, apply) ?? reading;
}

/**
 * Whether the latest press of a toggle is still outstanding: not yet answered
 * by the craft, or answered and not yet shown by the readings. A press that was
 * refused, failed, lost or never left asked for nothing the control should
 * count on, even while its row waits to be dismissed.
 */
export function pressOutstanding(
  status: CommandStatus | undefined,
  rows: readonly InFlightCommandLike[],
): boolean {
  if (status === undefined || status.phase === "idle") return false;
  if (status.phase === "in-flight") return true;
  if (status.phase !== "confirmed" && status.phase !== "found") return false;
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
