import type { CommandStatus, InFlightCommand } from "@ksp-gonogo/sitrep-sdk";
import type { ReckoningMarking } from "@ksp-gonogo/ui-kit";
import { useEffect, useRef, useState } from "react";

/**
 * What a toggle button shows of a command while the state it shows is not yet
 * the one the command sets: `sent` for a moment after this screen's press, and
 * longer while the mod has not yet answered it, `held` while the route has a command for the toggle
 * waiting at a relay for a link, whichever screen of the command centre sent
 * it. `modelled` once a command for the toggle is predicted to have reached
 * the craft and its reply is still on its way back: the button shows the state
 * the command sets, marked modelled. Null otherwise: where a command is on its
 * way is the delay rail's to show.
 */
export type ToggleConfirmation = "held" | "sent" | "modelled";

/**
 * The word a toggle button shows in place of its state while a confirmation is
 * outstanding. A held command shows no word: the button keeps its state and
 * wears the kit's held mark instead, see {@link heldCommandMarking}.
 */
export const CONFIRMATION_WORDS: Record<
  Exclude<ToggleConfirmation, "held" | "modelled">,
  string
> = {
  sent: "SENT",
};

/** Every confirmation word, for sizing a button so it keeps its size as the word changes. */
export const ALL_CONFIRMATION_WORDS: readonly string[] =
  Object.values(CONFIRMATION_WORDS);

/** The word a toggle button shows for a confirmation, or null where it keeps its state. */
export function confirmationWordOf(
  confirmation: ToggleConfirmation | null,
): string | null {
  return confirmation === "sent" ? CONFIRMATION_WORDS.sent : null;
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
  if (confirmation !== "held" && confirmation !== "modelled") return existing;
  const caption = confirmationSentenceOf(label, confirmation) ?? "";
  return {
    kind: confirmation,
    caption: existing === null ? caption : `${existing.caption}. ${caption}`,
  };
}

/** The part of a command handle a toggle reads its confirmation from. */
export interface ToggleCommandLike {
  status: CommandStatus;
  inFlight: readonly InFlightCommand[];
}

/**
 * The toggle's confirmation from its command handle. `forToggle` picks the
 * rows that are this toggle's where one command serves several, as action
 * groups share one.
 */
export function toggleConfirmationOf(
  command: ToggleCommandLike,
  forToggle: (row: InFlightCommand) => boolean = () => true,
): ToggleConfirmation | null {
  const { status } = command;
  if (status.phase === "in-flight" && status.accepted !== true) return "sent";
  const rows = command.inFlight.filter(forToggle);
  if (rows.some((row) => row.held === true)) return "held";
  // Each press inverts the toggle, so an odd number arrived and unanswered predicts the opposite state.
  // A press whose reply is back is no longer modelled, though its row stays until the readings show it.
  const answered =
    status.phase === "in-flight" || status.phase === "idle"
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
export function shownToggleState<T>(
  reading: T,
  confirmation: ToggleConfirmation | null,
): T | boolean {
  return confirmation === "modelled" && typeof reading === "boolean"
    ? !reading
    : reading;
}

/**
 * Whether this screen's latest press of a toggle is still outstanding: not yet
 * answered by the craft, or answered and not yet shown by the readings. Another
 * screen's press is not this screen's to build on, since its args are not known
 * here.
 */
export function pressOutstanding(command: ToggleCommandLike): boolean {
  const { status } = command;
  if (status.phase === "idle") return false;
  if (status.phase === "in-flight") return true;
  return command.inFlight.some((row) => row.id === status.requestId);
}

/** How long a toggle reads "SENT" after a press, at least, so the press is seen to have gone. */
export const SENT_FLASH_MS = 500;

/**
 * {@link toggleConfirmationOf}, with `sent` held for at least
 * {@link SENT_FLASH_MS} from each new press, however soon the mod answers it.
 */
export function useToggleConfirmation(
  command: ToggleCommandLike,
  forToggle?: (row: InFlightCommand) => boolean,
): ToggleConfirmation | null {
  const base = toggleConfirmationOf(command, forToggle);
  const { status } = command;
  const requestId = status.phase === "idle" ? null : status.requestId;
  // A command already out when the toggle mounts was not pressed here and now.
  const seenRef = useRef(requestId);
  const [flashing, setFlashing] = useState<string | null>(null);
  useEffect(() => {
    if (requestId === null || requestId === seenRef.current) return;
    seenRef.current = requestId;
    setFlashing(requestId);
    const timer = setTimeout(() => setFlashing(null), SENT_FLASH_MS);
    return () => clearTimeout(timer);
  }, [requestId]);
  return flashing !== null && flashing === requestId ? "sent" : base;
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
      return `${label} sent, not yet received`;
    case "modelled":
      return `${label} shown as predicted: the command should have reached the craft, and its reply is on its way back`;
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
