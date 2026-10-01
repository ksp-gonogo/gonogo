import { useTelemetry } from "@ksp-gonogo/core";
import { stillTrue, VesselType } from "@ksp-gonogo/sitrep-sdk";
import type { CommandButtonHandle } from "@ksp-gonogo/ui-kit";
import { FlyVesselMenu } from "./FlyVesselMenu";
import { TrackingStationControl } from "./TrackingStationControl";

/**
 * The way out of the Tracking Station. Nothing else in the widget works from
 * here, so without it an operator driving from the app is stranded: the mod
 * saves first, then loads the Space Center or the chosen vessel's flight.
 */
export function TrackingStationPanel({
  toSpaceCenterCmd,
  switchCmd,
}: {
  toSpaceCenterCmd: CommandButtonHandle;
  switchCmd: CommandButtonHandle;
}) {
  // The roster changes on events, so the last one received still lists the fleet.
  const roster = stillTrue(useTelemetry("system.vessels"), undefined);
  const vessels = (roster?.vessels ?? []).filter(
    (v) => v.vesselType !== VesselType.SpaceObject,
  );
  return (
    <FlyVesselMenu vessels={vessels} switchCmd={switchCmd}>
      <TrackingStationControl
        handle={toSpaceCenterCmd}
        label="Space Center"
        commandLabel="Go to Space Center"
        bindAs="spaceCenter"
      />
    </FlyVesselMenu>
  );
}
