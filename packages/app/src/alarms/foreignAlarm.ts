import { useTelemetry } from "@ksp-gonogo/core";
import type { ForeignScetAlarm } from "./types";

/**
 * Whether a foreign alarm's name and condition are kept from this screen.
 *
 * Withheld when this screen observes from a vantage other than the one that
 * armed it, because what another place is watching would otherwise reach here
 * faster than light could carry it. A TIME alarm is never withheld: a
 * universal time names no craft and is the same instant everywhere.
 *
 * Withheld when this screen's vantage is not known yet, and still withheld
 * after the alarm fires: the fire notice travels without delay, so lifting it
 * then would disclose the watched condition at the very instant light could
 * not have.
 */
export function conditionWithheld(
  alarm: ForeignScetAlarm,
  observedVantage: string | undefined,
): boolean {
  if (alarm.condition?.kind === "time") return false;
  return observedVantage === undefined || observedVantage !== alarm.armedBy;
}

/**
 * Names a vantage id the way the command-centre roster does, so an operator
 * reads "Sally-Hut 1" rather than `vessel:<guid>`. An id the roster does not
 * carry (a centre that has since gone, or a roster not yet arrived) reads as
 * itself.
 */
export function useVantageName(): (vantageId: string) => string {
  const reading = useTelemetry("commandCentre.roster");
  const roster =
    reading.state === "observed" || reading.state === "held"
      ? reading.value
      : undefined;
  return (vantageId) =>
    roster?.find((c) => c.id === vantageId)?.displayName ?? vantageId;
}
