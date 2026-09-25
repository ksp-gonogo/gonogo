import { value } from "@ksp-gonogo/sitrep-sdk";
import {
  MissionDate,
  type TimeContext,
  writeQuantity,
} from "@ksp-gonogo/ui-kit";
import styled from "styled-components";
import type { Alarm } from "./types";
import { isAtSubjectVantage, modOwnsLatch } from "./types";

export interface FiredFactsProps {
  alarm: Alarm;
  /** The game's reported warp rate now. */
  warpRate: number;
  /** One-way light time behind this screen's readings, seconds. */
  owltSeconds: number;
  /** Whether the link to the craft currently has no path at all. */
  noPath: boolean;
  /** Qualifier for an instant on the craft's own clock. */
  scet: TimeContext | undefined;
  /** Qualifier for an instant on this screen's arrival clock. */
  received: TimeContext | undefined;
}

/**
 * What the banner states about a fired alarm, beside its name: the instant it
 * fired at the vantage it was read at, that the warp is stopped, and, for an
 * alarm read aboard the craft, how far this screen's readings trail that
 * instant. An alarm read aboard fires a light-time before the readings beside
 * it can show why, so the gap is said out loud rather than left to look like a
 * disagreement.
 */
export function FiredFacts({
  alarm,
  warpRate,
  owltSeconds,
  noPath,
  scet,
  received,
}: FiredFactsProps) {
  const aboard = isAtSubjectVantage(alarm.trigger);
  const at = firedAt(alarm);
  return (
    <>
      {at !== null && (
        <Fact>
          <MissionDate value={at} context={aboard ? scet : received} />
        </Fact>
      )}
      {warpRate <= 1.0001 && <Fact>Warp stopped.</Fact>}
      {aboard && noPath && (
        <Fact>
          No signal: nothing on this screen reflects the craft's state at the
          moment this fired.
        </Fact>
      )}
      {aboard && !noPath && owltSeconds >= 1 && (
        <Fact>
          Your readings are {writeQuantity(value("s", owltSeconds))} behind the
          craft and do not show this yet.
        </Fact>
      )}
    </>
  );
}

/**
 * The instant the alarm fired, on the clock of the vantage it was read at, or
 * null where nothing recorded one. An alarm read aboard, and an event, carry
 * the instant the thing happened; one the mod latched at a command vantage
 * fired when this screen was told, which is its latch; one evaluated here came
 * due once its match had held for its sustain.
 */
function firedAt(alarm: Alarm): number | null {
  const t = alarm.trigger;
  if (isAtSubjectVantage(t) || t.kind === "event") return alarm.eventUT ?? null;
  if (t.kind === "time") return t.ut;
  if (alarm.matchSinceUT == null) return null;
  return modOwnsLatch(t)
    ? alarm.matchSinceUT
    : alarm.matchSinceUT + t.sustainSeconds;
}

const Fact = styled.span`
  color: inherit;
`;
