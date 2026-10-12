import type { SendStatus, Value } from "@ksp-gonogo/sitrep-sdk";
import { writeQuantity } from "../units";

const quantity = (seconds: Value<"s">) => writeQuantity(seconds);

/** Every word the status can say, keyed by state, so a wording change is an edit here and nowhere else. */
const WORDS = {
  contact: {
    "in-contact": () => "In contact",
    "loss-in": (seconds: Value<"s">) => `LOS in ${quantity(seconds)}`,
    "back-in": (seconds: Value<"s">) =>
      `No contact, back in ${quantity(seconds)}`,
    none: () => "No contact",
  },
  delay: {
    held: (seconds: Value<"s">) => `${quantity(seconds)} signal delay`,
    absent: () => "no signal path",
  },
  arrival: {
    expected: "Expected to arrive",
    "likely-lost": "Likely lost",
  },
  sends: {
    now: () => "Sends now",
    held: (until: Value<"ut">, arrives: Value<"ut"> | undefined) =>
      arrives === undefined
        ? `Held until ${writeQuantity(until)}`
        : `Held until ${writeQuantity(until)}, arrives ${writeQuantity(arrives)}`,
  },
} as const;

/**
 * A send status as the two lines a command control shows: the contact state
 * and the signal delay, then what the send does (sends now, held until a
 * stated time and arriving at another, or whether a message is expected to
 * arrive). Written for a tooltip or an accessible name. Used by
 * {@link CommandButton} for its tooltip.
 *
 * @category Commands
 */
export function describeSendStatus(status: SendStatus): string {
  const { contact } = status;
  const first =
    contact.kind === "loss-in" || contact.kind === "back-in"
      ? WORDS.contact[contact.kind](contact.seconds)
      : WORDS.contact[contact.kind]();
  const delay =
    status.signalDelay === undefined
      ? WORDS.delay.absent()
      : WORDS.delay.held(status.signalDelay);
  const second =
    status.sends === "now" && status.arrival === "expected"
      ? WORDS.sends.now()
      : status.sends === "held" && status.heldUntilUt !== undefined
        ? WORDS.sends.held(status.heldUntilUt, status.arrivesUt)
        : WORDS.arrival[status.arrival];
  return `${first} · ${delay}\n${second}`;
}
