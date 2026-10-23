import { useLatestValue } from "./use-stream";

const CRAFT_SOURCE_PREFIX = "vessel:";

/**
 * The id of the craft the game has active, off the source of the newest
 * `comms.delay` the command centre received, or `undefined` before one has
 * arrived or while the report is about the session rather than a craft.
 *
 * `comms.delay` is stamped when it is sent, not held back by the signal delay,
 * so it names the active craft at once after a switch, while every reading of
 * the craft itself still comes from the one before.
 */
export function useActiveCraftId(): string | undefined {
  const delay = useLatestValue<{ meta?: { source?: unknown } }>("comms.delay");
  const source = delay?.meta?.source;
  return typeof source === "string" && source.startsWith(CRAFT_SOURCE_PREFIX)
    ? source.slice(CRAFT_SOURCE_PREFIX.length)
    : undefined;
}

/**
 * Whether a reading's payload is about a craft other than the active one. A
 * reading naming no craft, or read before the active craft is known, is not
 * judged to be another's.
 */
export function isOtherCraftsReading(
  activeCraftId: string | undefined,
  payloadMeta: { source?: unknown } | undefined,
): boolean {
  const source = payloadMeta?.source;
  return (
    activeCraftId !== undefined &&
    typeof source === "string" &&
    source.startsWith(CRAFT_SOURCE_PREFIX) &&
    source !== CRAFT_SOURCE_PREFIX + activeCraftId
  );
}
