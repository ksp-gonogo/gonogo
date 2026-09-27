import { useTelemetry } from "@ksp-gonogo/sitrep-sdk";
import { Stat, StatStrip, Unit } from "@ksp-gonogo/ui-kit";

/**
 * The smallest widget body that reads telemetry: one Topic, three of its
 * fields, each handed to `Unit` whole so the reading's state is drawn with it.
 */
export function FlightReadout() {
  const flight = useTelemetry("vessel.flight");
  return (
    <StatStrip>
      <Stat label="Altitude">
        <Unit value={flight.altitudeAsl} />
      </Stat>
      <Stat label="Vertical speed">
        <Unit value={flight.verticalSpeed} />
      </Stat>
      <Stat label="Surface speed">
        <Unit value={flight.surfaceSpeed} />
      </Stat>
    </StatStrip>
  );
}
