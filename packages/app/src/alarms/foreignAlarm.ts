import { useTelemetry } from "@ksp-gonogo/core";

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
