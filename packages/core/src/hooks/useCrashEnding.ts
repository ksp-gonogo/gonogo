import {
  observedAt,
  type TopicPayload,
  type Value,
  value,
} from "@ksp-gonogo/sitrep-sdk";
import { useTelemetry } from "./useTelemetry";

/** The report of the crash a flight ended in. */
export type CrashReportOfEnding = TopicPayload<"crash.lastCrash">;

/** How far earlier than the crash the flight clock must read to be a revert and not the last frames before the crash event. */
const REVERT_MARGIN = value("s", 10);

/**
 * The crash that ended the flight being watched, or undefined while none has.
 *
 * The mod publishes `crash.hasRecent` as true when a flight records its first crash and never publishes it as false, so it holds for the rest of the save and a reconnect replays the report: it says a crash is on record, not that the flight it belongs to is the one in view. The ending therefore ends where the widget can see the flight has moved on: another vessel is the one reporting, or the flight clock reads earlier than the crash (a revert to the same craft).
 */
export function crashEndingOf(inputs: {
  recent: boolean;
  report: CrashReportOfEnding | undefined;
  /** The vessel reporting now, or undefined when none is. */
  vesselId: string | undefined;
  /** When the vessel's flight reading was made, where there is one. */
  flightAt?: Value<"ut"> | undefined;
}): CrashReportOfEnding | undefined {
  const { recent, report: crash, vesselId, flightAt } = inputs;
  if (recent !== true || crash === undefined) return undefined;
  if (vesselId !== undefined && vesselId !== crash.vesselId) return undefined;
  if (flightAt !== undefined && crash.ut?.isFinite() === true) {
    if (flightAt.plus(REVERT_MARGIN).lessThan(crash.ut)) return undefined;
  }
  return crash;
}

/** {@link crashEndingOf} read off the stream: a crash is a record of an event that already happened, so a held reading is still true. */
export function useCrashEnding(): CrashReportOfEnding | undefined {
  const flag = useTelemetry("crash.hasRecent");
  const report = useTelemetry("crash.lastCrash");
  const identity = useTelemetry("vessel.identity");
  const flight = useTelemetry("vessel.flight");
  return crashEndingOf({
    recent:
      (flag.state === "observed" || flag.state === "held") &&
      flag.value.recent === true,
    report:
      report.state === "observed" || report.state === "held"
        ? report.value
        : undefined,
    vesselId:
      identity.state === "observed" || identity.state === "held"
        ? identity.value.vesselId
        : undefined,
    flightAt: flight.state === "observed" ? observedAt(flight) : undefined,
  });
}
