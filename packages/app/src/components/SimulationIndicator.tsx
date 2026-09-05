import { useTelemetry } from "@ksp-gonogo/core";
import { Badge, Cluster } from "@ksp-gonogo/ui-kit";

/**
 * Says, on the board itself, that the flight everything else is describing is
 * a REHEARSAL.
 *
 * Every other readout on screen is a true reading of a flight that is not
 * happening: altitude, stage, crew, fuel, the countdown. Carrying the fact on
 * the wire is what makes it knowable; this is what makes it known, and without
 * it an operator glancing at the board has nothing to tell the two apart.
 *
 * The second badge is there because a live board is itself a claim. A
 * rehearsal has no spacecraft and so no light-time, so gonogo cuts the delay
 * for one by default, and an operator who is used to reading a delayed board
 * needs to know that this one is not. It disappears when the operator has
 * asked to rehearse under the delay (Settings, RP-1), because then the board
 * is delayed and the ordinary reading applies.
 *
 * Absent under a game with no rehearsal mode, which is every stock one:
 * `flight.simulation` publishes nothing there, so this renders nothing rather
 * than a MISSION badge it has no basis for.
 */
export function SimulationIndicator() {
  /*
   * A discrete game fact, the same reasoning as the scene: a flight does not
   * stop being a rehearsal because a frame went missing, so a stale reading is
   * still the reading and only never-arrived is unknown.
   *
   * Unlike the scene, `flight.simulation` is NOT in `NEVER_RECKONABLE`, so a
   * reading of it can carry a model. That changes nothing here on purpose: the
   * value wanted is the flag the game reported, not a projection of one, so
   * both `reckoning` arms of each state are read the same way.
   */
  const reading = useTelemetry("flight.simulation");
  const payload =
    reading.state === "observed" || reading.state === "stale"
      ? reading.value
      : undefined;

  if (payload?.simulated !== true) return null;

  return (
    <Cluster justify="start" align="center" role="status" aria-live="polite">
      <Badge severity="caution">SIMULATION</Badge>
      {!payload.delayApplied && <Badge severity="info">DELAY CUT</Badge>}
    </Cluster>
  );
}
