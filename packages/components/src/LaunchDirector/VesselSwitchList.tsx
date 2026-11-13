import {
  type AnyBoundCommand,
  type Reading,
  type SwitchableVessel,
  type Value,
  VesselType,
} from "@ksp-gonogo/sitrep-sdk";
import { Cluster, Row, ToggleButton, Tooltip, Unit } from "@ksp-gonogo/ui-kit";
import { useMemo } from "react";
import { magnitudeOf } from "../shared/magnitude";
import {
  VesselSwitchDistance,
  VesselSwitchHint,
  VesselSwitchMeta,
  VesselSwitchName,
  VesselSwitchPanel,
} from "./styles";
import { VESSEL_TYPE_LABELS } from "./vesselTypeLabels";

function rangeOf(reading: Reading<Value<"m">> | undefined): number {
  const range =
    reading?.state === "observed" || reading?.state === "held"
      ? reading.value
      : undefined;
  return magnitudeOf(range) ?? Number.POSITIVE_INFINITY;
}

/** The other vessels in the save, nearest first and unranged ones by name after them; picking one sends the switch. */
export function VesselSwitchList({
  vessels,
  distanceOf,
  showSpaceObjects,
  onToggleSpaceObjects,
  switchCommand,
}: {
  vessels: readonly SwitchableVessel[];
  /** Each vessel's range as a reading of the roster, so a held roster marks it; none where the roster does not list the vessel. */
  distanceOf: (entry: SwitchableVessel) => Reading<Value<"m">> | undefined;
  /** Held by the caller, so the choice survives the list closing. */
  showSpaceObjects: boolean;
  onToggleSpaceObjects: () => void;
  /** The command that switches to the vessel with this id and name. */
  switchCommand: (vesselId: string, name: string) => AnyBoundCommand;
}) {
  const spaceObjectCount = useMemo(
    () => vessels.filter((e) => e.vesselType === VesselType.SpaceObject).length,
    [vessels],
  );
  const switchableVessels = useMemo(() => {
    // SpaceObjects (asteroids, comets) are hidden unless the toggle reveals them.
    const list = showSpaceObjects
      ? vessels
      : vessels.filter((e) => e.vesselType !== VesselType.SpaceObject);
    return [...list].sort((a, b) => {
      const da = rangeOf(distanceOf(a));
      const db = rangeOf(distanceOf(b));
      return da === db ? a.name.localeCompare(b.name) : da - db;
    });
  }, [vessels, showSpaceObjects, distanceOf]);
  return (
    <VesselSwitchPanel role="group" aria-label="Switch active vessel">
      {spaceObjectCount > 0 && (
        <Cluster justify="start">
          <Tooltip
            text={
              showSpaceObjects
                ? "Hide asteroids / comets from the list"
                : "Show asteroids / comets in the list"
            }
          >
            <ToggleButton
              size="sm"
              pressed={showSpaceObjects}
              onClick={onToggleSpaceObjects}
            >
              {showSpaceObjects
                ? `Asteroids: shown (${spaceObjectCount})`
                : `Asteroids: hidden (${spaceObjectCount})`}
            </ToggleButton>
          </Tooltip>
        </Cluster>
      )}
      {switchableVessels.length === 0 ? (
        <VesselSwitchHint>No other vessels to show.</VesselSwitchHint>
      ) : (
        switchableVessels.map((entry) => (
          <Row
            as="button"
            interactive
            key={entry.vesselId}
            type="button"
            command={switchCommand(entry.vesselId, entry.name)}
          >
            <VesselSwitchName>
              <span>{entry.name}</span>
              <VesselSwitchMeta>
                {VESSEL_TYPE_LABELS[entry.vesselType ?? -1] ?? "Unknown"}
              </VesselSwitchMeta>
            </VesselSwitchName>
            <VesselSwitchDistance>
              <Unit value={distanceOf(entry)} />
            </VesselSwitchDistance>
          </Row>
        ))
      )}
    </VesselSwitchPanel>
  );
}
