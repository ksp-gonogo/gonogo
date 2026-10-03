import { type Value, value } from "@ksp-gonogo/sitrep-sdk";
import { writeQuantity } from "@ksp-gonogo/ui-kit";

/** Whether the addressee can be reached now, and when that changes. */
export type ContactStatus =
  | { kind: "in-contact" }
  | { kind: "loss-in"; seconds: Value<"s"> }
  | { kind: "back-in"; seconds: Value<"s"> }
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

const duration = (seconds: Value<"s"> | number) =>
  writeQuantity(typeof seconds === "number" ? value("s", seconds) : seconds);

/** Every word the status can say, keyed by state, so a wording change is an edit here and nowhere else. */
const WORDS = {
  contact: {
    "in-contact": () => "In contact",
    "loss-in": (seconds: Value<"s">) => `LOS in ${duration(seconds)}`,
    "back-in": (seconds: Value<"s">) =>
      `No contact, back in ${duration(seconds)}`,
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

/** One pair of the contact plan; an absent edge is a window already open at the plan's start or still open at its horizon. */
export interface PlannedContact {
  a: string;
  b: string;
  horizonUt: Value<"ut">;
  windows: readonly {
    openUt?: Value<"ut"> | null;
    closeUt?: Value<"ut"> | null;
  }[];
}

/**
 * When the plan next opens direct contact between two addresses after `utNow`.
 * Undefined when the plan does not cover the pair, predicts no window before the
 * pair's horizon, or predicts contact at `utNow`: the roster has just said
 * otherwise, and the live link outranks a prediction.
 */
export function nextContactUt(
  plan: readonly PlannedContact[],
  from: string,
  to: string,
  utNow: number,
): Value<"ut"> | undefined {
  const pair = plan.find(
    (p) => (p.a === from && p.b === to) || (p.a === to && p.b === from),
  );
  if (!pair) return undefined;
  const now = value("ut", utNow);
  for (const window of pair.windows) {
    const closes = window.closeUt ?? pair.horizonUt;
    if (!closes.greaterThan(now)) continue;
    return window.openUt?.greaterThan(now) ? window.openUt : undefined;
  }
  return undefined;
}

/**
 * The status for a send to a group, given who in it the roster no longer lists.
 * `backInSeconds` is how long until the plan predicts every one of them back in
 * direct contact with this vantage; a relay can bring one back sooner, so it is
 * the latest the contact returns rather than the earliest. Without it the return
 * is unknown. Either way the words go now and nothing holds them for the return,
 * so they are likely lost; an addressee in contact has no status to show.
 */
export function sendStatusFor(
  unreachable: readonly string[],
  backInSeconds?: Value<"s">,
): SendStatus | undefined {
  if (unreachable.length === 0) return undefined;
  return {
    contact:
      backInSeconds === undefined
        ? { kind: "none" }
        : { kind: "back-in", seconds: backInSeconds },
    arrival: "likely-lost",
  };
}
