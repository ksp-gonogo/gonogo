import { PerfBudget } from "@ksp-gonogo/core";
import { BODY_TEXTURE_TOPIC_PREFIX } from "@ksp-gonogo/data";
import type { BinaryFrameInfo } from "@ksp-gonogo/sitrep-client";

/**
 * Payload bytes arriving on the binary lane, per second, summed across every
 * segment of every frame, body maps excepted.
 *
 * A real byte count, unlike `StreamFrameInfo.byteLength` next door, which is a
 * UTF-16 string length. Sized identically to the shipped `RADIO_BYTES_BUDGET`
 * and for its stated reason: loose enough to survive a codec that overshoots
 * its bitrate hint (firefox does, measured at 4338 B/s against a 24 kbit hint),
 * tight enough that raw PCM cannot hide behind it, since int16 at 16 kHz is
 * 32 kB/s and trips this inside a second.
 *
 * Paired with the frame budget: bytes high with frames low is a producer
 * sending more than it should; frames high with bytes low is a producer that
 * is not batching.
 */
export const SITREP_BINARY_BYTES_BUDGET = new PerfBudget({
  name: "Telemetry binary-lane bytes/sec",
  threshold: 40_000,
  windowMs: 1000,
  unit: "bytes",
});

/**
 * Body-map bytes arriving on the binary lane, per second.
 *
 * The mod sends each body's map once per subscription, so the most a correct
 * client receives is every body at once: the stock system's 17 maps are about
 * 68 MB in all, and a cached burst on the Steam Deck arrived at up to about
 * 19 MB/s. The threshold is five times that rate and above a whole stock set
 * landing within one second, so only a client that resubscribes in a loop, or
 * a mod that sends a map more than once, goes over it.
 */
export const SITREP_BODY_MAP_BYTES_BUDGET = new PerfBudget({
  name: "Telemetry body-map bytes/sec",
  threshold: 96_000_000,
  windowMs: 1000,
  unit: "bytes",
});

/** Counts one binary-lane frame's bytes against the budget its traffic was sized for. */
export function recordBinaryLaneBytes(
  info: Pick<BinaryFrameInfo, "topic" | "byteLength">,
  now?: number,
): void {
  const budget = info.topic.startsWith(BODY_TEXTURE_TOPIC_PREFIX)
    ? SITREP_BODY_MAP_BYTES_BUDGET
    : SITREP_BINARY_BYTES_BUDGET;
  budget.record(info.byteLength, now);
}
