import type { ServerMessage } from "@ksp-gonogo/sitrep-sdk";

/** Messages, acknowledgements and membership changes, addressed per vantage by the mod. */
export const COMMCAST_TRAFFIC_TOPIC = "commcast.traffic";

/** Live radio on the binary lane, addressed the same way. */
export const COMMCAST_RADIO_TOPIC = "commcast.radio";

/**
 * Whether a frame is a transmission rather than a reading.
 *
 * A relay that answers a late subscriber from its last frame per topic must
 * never do so for one of these: it would replay something said to a screen that
 * was not listening when it arrived, as though it had just been said.
 */
export function isTransmission(message: ServerMessage): boolean {
  return (
    (message.type === "stream-data" || message.type === "stream-binary") &&
    (message.topic === COMMCAST_TRAFFIC_TOPIC ||
      message.topic === COMMCAST_RADIO_TOPIC)
  );
}
