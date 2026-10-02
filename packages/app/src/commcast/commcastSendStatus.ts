import { writeQuantity } from "@ksp-gonogo/ui-kit";

/** Whether the addressee can be reached now, and when that changes. */
export type ContactStatus =
  | { kind: "in-contact" }
  | { kind: "loss-in"; seconds: number }
  | { kind: "back-in"; seconds: number }
  | { kind: "none" };

/** What a send is expected to do, assuming nobody intervenes. */
export type Arrival = "expected" | "likely-lost";

/** Everything the send control says about a message before it is sent. */
export interface SendStatus {
  contact: ContactStatus;
  /** One-way signal time along the route; absent when there is no route. */
  signalDelaySeconds?: number;
  arrival: Arrival;
}

const duration = (seconds: number) =>
  writeQuantity({ magnitude: seconds, unit: "s" });

/** Every word the status can say, keyed by state, so a wording change is an edit here and nowhere else. */
const WORDS = {
  contact: {
    "in-contact": () => "In contact",
    "loss-in": (seconds: number) => `LOS in ${duration(seconds)}`,
    "back-in": (seconds: number) => `No contact, back in ${duration(seconds)}`,
    none: () => "No contact",
  },
  delay: {
    held: (seconds: number) => `${duration(seconds)} signal delay`,
    absent: () => "no signal path",
  },
  arrival: {
    expected: "Expected to arrive",
    "likely-lost": "Likely lost",
  },
} as const;

/** The status as the two lines the send control's tooltip shows. */
export function describeSendStatus(status: SendStatus): string {
  const { contact } = status;
  const first =
    contact.kind === "loss-in" || contact.kind === "back-in"
      ? WORDS.contact[contact.kind](contact.seconds)
      : WORDS.contact[contact.kind]();
  const delay =
    status.signalDelaySeconds === undefined
      ? WORDS.delay.absent()
      : WORDS.delay.held(status.signalDelaySeconds);
  return `${first} · ${delay}\n${WORDS.arrival[status.arrival]}`;
}

/**
 * The status Commcast can determine today. An addressee the roster no longer
 * lists is out of contact with no return known; nothing predicts a loss of
 * signal or a return, so the other states are not produced here, and an
 * addressee in contact has no status to show.
 */
export function sendStatusFor(
  unreachable: readonly string[],
): SendStatus | undefined {
  if (unreachable.length === 0) return undefined;
  return { contact: { kind: "none" }, arrival: "likely-lost" };
}
