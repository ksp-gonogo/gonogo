import { railTagsForTelemetry } from "@ksp-gonogo/sitrep-sdk";
import { useRailEntry } from "@ksp-gonogo/ui-kit";
import {
  type Separation,
  type SeparationMatrix,
  separationBetween,
  transitSecondsOf,
} from "../reveal";
import type { RecipientId } from "../types";
import { crossingSpanSamples } from "./RadioPtt";
import type { RadioLight } from "./RadioSession";

/**
 * What a voice arriving here is on the rail's three axes: telemetry, because it
 * comes to this screen rather than leaving it, continuous because a keying
 * occupies a span of time, and fire-and-forget because nothing replies to it.
 * Direction is what lays its ribbon in the confirmed zone.
 */
const INBOUND_VOICE_TAGS = railTagsForTelemetry("continuous");

/**
 * Puts every voice reaching this screen on the delay rail of the panel it sits
 * in, as a ribbon of how loud it was as it arrived. Renders nothing. Useful for
 * showing the operator that someone is talking to them and how long that voice
 * took to cross. Used by Commcast.
 *
 * The delay each ribbon is placed on is the one from its speaker to this
 * vantage, read the way the widget reads every other separation: the published
 * pair first, then `fallbackSeconds`. A speaker with no path to here is not
 * drawn.
 */
export function RadioInboundRail({
  live,
  me,
  fallbackSeconds,
  pairs,
  nameFor,
}: {
  live: readonly RadioLight[];
  me: RecipientId | undefined;
  fallbackSeconds: number | null | undefined;
  pairs: SeparationMatrix | undefined;
  nameFor: (id: RecipientId) => string;
}) {
  const ribbons = live.flatMap((light) => {
    const separation: Separation = separationBetween(
      light.from,
      me,
      fallbackSeconds,
      pairs,
    );
    const seconds = transitSecondsOf(separation);
    if (seconds === null) return [];
    const label = `Voice from ${nameFor(light.from)} arriving`;
    return [
      {
        id: `radio.in.${light.transmissionId}`,
        label,
        oneWaySeconds: seconds,
        amplitudes: light.amplitudes,
        wave: light.waves,
        spanSamples: crossingSpanSamples(seconds),
        tags: INBOUND_VOICE_TAGS,
      },
    ];
  });
  const first = ribbons[0];
  useRailEntry(
    first === undefined
      ? null
      : {
          inFlight: [],
          tags: INBOUND_VOICE_TAGS,
          effectiveDelaySeconds: first.oneWaySeconds,
          "aria-label": first.label,
          ribbons,
        },
  );
  return null;
}
