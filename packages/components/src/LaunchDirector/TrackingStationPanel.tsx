import { useTelemetry } from "@ksp-gonogo/core";
import { stillTrue, VesselType } from "@ksp-gonogo/sitrep-sdk";
import type { CommandButtonHandle } from "@ksp-gonogo/ui-kit";
import { useState } from "react";
import {
  InFlightWrap,
  PadActions,
  TrackingStationButton,
  VesselSwitchHint,
  VesselSwitchMeta,
  VesselSwitchName,
  VesselSwitchPanel,
  VesselSwitchRow,
} from "./styles";
import { TrackingStationControl } from "./TrackingStationControl";
import { VESSEL_TYPE_LABELS } from "./vesselTypeLabels";

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
  const [flyOpen, setFlyOpen] = useState(false);
  // The roster changes on events, so the last one received still lists the fleet.
  const roster = stillTrue(useTelemetry("system.vessels"), undefined);
  const vessels = (roster?.vessels ?? []).filter(
    (v) => v.vesselType !== VesselType.SpaceObject,
  );
  return (
    <InFlightWrap>
      <PadActions>
        <TrackingStationControl
          handle={toSpaceCenterCmd}
          label="Space Center"
          commandLabel="Go to Space Center"
          bindAs="spaceCenter"
        />
        <TrackingStationButton
          type="button"
          disabled={vessels.length === 0}
          aria-expanded={flyOpen}
          onClick={() => setFlyOpen((v) => !v)}
          title={
            vessels.length === 0
              ? "No vessels in this save"
              : "Saves the game, then flies the vessel you pick"
          }
        >
          Fly vessel ▾
        </TrackingStationButton>
      </PadActions>
      {flyOpen && vessels.length > 0 && (
        <VesselSwitchPanel role="group" aria-label="Fly vessel">
          {vessels.map((v) => (
            <VesselSwitchRow
              key={v.vesselId}
              type="button"
              onClick={() => {
                setFlyOpen(false);
                void switchCmd.send({ vesselId: v.vesselId });
              }}
            >
              <VesselSwitchName>
                <span>{v.name}</span>
                <VesselSwitchMeta>
                  {VESSEL_TYPE_LABELS[v.vesselType] ?? "Unknown"}
                </VesselSwitchMeta>
              </VesselSwitchName>
            </VesselSwitchRow>
          ))}
        </VesselSwitchPanel>
      )}
      {flyOpen && vessels.length === 0 && (
        <VesselSwitchHint>No vessels to fly.</VesselSwitchHint>
      )}
    </InFlightWrap>
  );
}
