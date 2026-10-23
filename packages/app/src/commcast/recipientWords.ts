import { isSettled, type SentPhase } from "./reveal";
import type { Delivery } from "./types";

/** What the app knows about a recipient apart from the delivery itself. */
export interface RecipientAbout {
  /** Why the contact plan has no reach to the recipient, when it says. */
  noReachReason?: "unpowered";
  /** Whether a screen can answer at the recipient's centre right now; undefined when the roster does not say. */
  staffed?: boolean;
}

/**
 * What a sent message's hover list says about one recipient: that it was
 * received, that the game refused it, that it never left (and why, when the
 * contact plan says), that it is still on the way, or that its wait ran out
 * without an answer.
 */
export function recipientWords(
  phase: SentPhase,
  delivery: Delivery,
  about: RecipientAbout = {},
): string {
  if (phase === "confirmed") return "received";
  if (delivery.refused) return "not sent, the game refused it";
  if (delivery.neverLeft) {
    return about.noReachReason === "unpowered"
      ? "never left, no electric charge aboard"
      : "never left, no path";
  }
  if (!isSettled(phase)) return "on the way";
  // Only a screen open at the recipient's centre answers, so a wait that ran out says what the mod did and whether anyone could have answered.
  if (about.staffed === false) {
    return delivery.delivered
      ? "delivered, nobody is at its centre to answer"
      : "not acknowledged, nobody is at its centre to answer";
  }
  return delivery.delivered
    ? "delivered, no acknowledgement"
    : "not acknowledged";
}
