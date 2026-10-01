import type { VesselRosterEntry } from "@ksp-gonogo/sitrep-sdk";
import { Button, type CommandButtonHandle, Row } from "@ksp-gonogo/ui-kit";
import { type ReactNode, useState } from "react";
import {
  InFlightWrap,
  PadActions,
  VesselSwitchHint,
  VesselSwitchMeta,
  VesselSwitchName,
  VesselSwitchPanel,
} from "./styles";
import { VESSEL_TYPE_LABELS } from "./vesselTypeLabels";

/**
 * The "Fly vessel" trigger and the list it opens. The mod saves first, then
 * loads the chosen vessel's flight. `children` sit beside the trigger.
 */
export function FlyVesselMenu({
  vessels,
  switchCmd,
  children,
}: {
  vessels: readonly VesselRosterEntry[];
  switchCmd: CommandButtonHandle;
  children?: ReactNode;
}) {
  const [flyOpen, setFlyOpen] = useState(false);
  return (
    <InFlightWrap>
      <PadActions>
        {children}
        <Button
          type="button"
          variant="ghost"
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
        </Button>
      </PadActions>
      {flyOpen && vessels.length > 0 && (
        <VesselSwitchPanel role="group" aria-label="Fly vessel">
          {vessels.map((v) => (
            <Row
              as="button"
              interactive
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
            </Row>
          ))}
        </VesselSwitchPanel>
      )}
      {flyOpen && vessels.length === 0 && (
        <VesselSwitchHint>No vessels to fly.</VesselSwitchHint>
      )}
    </InFlightWrap>
  );
}
