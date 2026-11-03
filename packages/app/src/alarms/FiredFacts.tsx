import { useTelemetry, useTimeContexts } from "@ksp-gonogo/core";
import { value } from "@ksp-gonogo/sitrep-sdk";
import {
  MissionDate,
  type TimeContext,
  writeQuantity,
} from "@ksp-gonogo/ui-kit";
import styled from "styled-components";
import type { Alarm } from "./types";
import { isAtSubjectVantage } from "./types";

export interface FiredFactsProps {
  alarm: Alarm;
  /** The game's reported warp rate now. */
  warpRate: number;
  /** One-way signal delay behind this screen's readings, seconds. */
  owltSeconds: number;
  /** Whether the link to the craft currently has no path at all. */
  noPath: boolean;
  /** Qualifier for an instant on the craft's own clock. */
  scet: TimeContext | undefined;
  /** Qualifier for an instant on this screen's arrival clock. */
  received: TimeContext | undefined;
  /** The instant this screen's readings have reached, or null when unknown. */
  viewUt: number | null;
}

/**
 * FiredFacts fed from this screen's own warp rate, signal delay and clocks, so
 * the main screen and every station state the same facts for a fired alarm.
 */
export function ScreenFiredFacts({
  alarm,
  warpRate,
  viewUt,
}: {
  alarm: Alarm;
  warpRate: number;
  viewUt: number | null;
}) {
  const timeContexts = useTimeContexts();
  const delay = useTelemetry("comms.delay");
  const noPath =
    (delay.state === "observed" || delay.state === "held") &&
    delay.value.oneWaySeconds == null;
  return (
    <FiredFacts
      alarm={alarm}
      warpRate={warpRate}
      owltSeconds={timeContexts.owltSeconds}
      noPath={noPath}
      scet={timeContexts.scet}
      received={timeContexts.received}
      viewUt={viewUt}
    />
  );
}

/**
 * What the banner states about a fired alarm, beside its name: the instant it
 * fired at the vantage it was read at, that the warp is stopped, and, for an
 * alarm read aboard the craft, how far this screen's readings trail that
 * instant. An alarm read aboard fires a signal delay before the readings beside
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
  viewUt,
}: FiredFactsProps) {
  const aboard = isAtSubjectVantage(alarm.trigger);
  const readingsBehind =
    viewUt === null || alarm.eventUT === undefined || viewUt < alarm.eventUT;
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
      {aboard && !noPath && owltSeconds >= 1 && readingsBehind && (
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
 * null where nothing recorded one. An alarm read aboard carries the instant
 * the thing happened; one read at a command vantage fired when this screen was
 * told, which is its latch.
 */
function firedAt(alarm: Alarm): number | null {
  return isAtSubjectVantage(alarm.trigger)
    ? (alarm.eventUT ?? null)
    : (alarm.matchSinceUT ?? null);
}

const Fact = styled.span`
  color: inherit;
`;
