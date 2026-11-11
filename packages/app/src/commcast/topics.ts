import type { ServerMessage } from "@ksp-gonogo/sitrep-sdk";

/** A centre's ledger of messages, addressed to its own vantage by the mod and read as state. */
export const COMMCAST_LEDGER_TOPIC = "commcast.ledger";

/** Live radio on the binary lane, addressed the same way. */
export const COMMCAST_RADIO_TOPIC = "commcast.radio";

/**
 * Whether a frame is a transmission rather than a reading.
 *
 * A relay that answers a late subscriber from its last frame per topic must
 * never do so for one of these: it would replay something said to a screen that
 * was not listening when it arrived, as though it had just been said. The
 * ledger is not one: it is state, and a late subscriber is meant to be handed
 * its latest value.
 */
export function isTransmission(message: ServerMessage): boolean {
  return (
    (message.type === "stream-data" || message.type === "stream-binary") &&
    message.topic === COMMCAST_RADIO_TOPIC
  );
}
