import {
  type Reading,
  type TargetListEntry,
  type Value,
  VesselType,
} from "@ksp-gonogo/sitrep-sdk";
import { Unit } from "@ksp-gonogo/ui-kit";
import { useMemo } from "react";
import { magnitudeOf } from "../shared/magnitude";
import {
  SpaceObjectToggle,
  VesselSwitchDistance,
  VesselSwitchHint,
  VesselSwitchMeta,
  VesselSwitchName,
  VesselSwitchPanel,
  VesselSwitchRow,
} from "./styles";
import { VESSEL_TYPE_LABELS } from "./vesselTypeLabels";

/** The other vessels in the save, nearest first; picking one sends the switch. */
export function VesselSwitchList({
  vessels,
  distanceOf,
  showSpaceObjects,
  onToggleSpaceObjects,
  onSwitch,
}: {
  vessels: readonly TargetListEntry[];
  /** Each vessel's range as a reading of the roster, so a held roster marks it. */
  distanceOf: (entry: TargetListEntry) => Reading<Value<"m">> | undefined;
  /** Held by the caller, so the choice survives the list closing. */
  showSpaceObjects: boolean;
  onToggleSpaceObjects: () => void;
  onSwitch: (vesselId: string) => void;
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
      const da = magnitudeOf(a.distance) ?? Number.POSITIVE_INFINITY;
      const db = magnitudeOf(b.distance) ?? Number.POSITIVE_INFINITY;
      return da - db;
    });
  }, [vessels, showSpaceObjects]);
  return (
    <VesselSwitchPanel role="listbox" aria-label="Switch active vessel">
      {spaceObjectCount > 0 && (
        <SpaceObjectToggle
          type="button"
          aria-pressed={showSpaceObjects}
          onClick={onToggleSpaceObjects}
          title={
            showSpaceObjects
              ? "Hide asteroids / comets from the list"
              : "Show asteroids / comets in the list"
          }
        >
          {showSpaceObjects
            ? `Asteroids: shown (${spaceObjectCount})`
            : `Asteroids: hidden (${spaceObjectCount})`}
        </SpaceObjectToggle>
      )}
      {switchableVessels.length === 0 ? (
        <VesselSwitchHint>No other vessels to show.</VesselSwitchHint>
      ) : (
        switchableVessels.map((entry) => (
          <VesselSwitchRow
            key={entry.vesselId ?? entry.name}
            type="button"
            onClick={() => {
              if (!entry.vesselId) return;
              onSwitch(entry.vesselId);
            }}
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
          </VesselSwitchRow>
        ))
      )}
    </VesselSwitchPanel>
  );
}
