import { useContributions } from "@ksp-gonogo/core";
import { useLatestValue, useUtNow } from "@ksp-gonogo/sitrep-client";
import type {
  CommsNetwork,
  Contributed,
  PendingUplinkQueue,
} from "@ksp-gonogo/sitrep-sdk";
import { useCallback, useMemo } from "react";
import { useFleetCommsToggles } from "../FleetComms/toggles";
import {
  COMMS_PATH_COLOUR,
  commsControlQuality,
  deriveCommsPath,
  NO_COMMS_PATH,
} from "./commsPath";
import { deriveTraffic, NO_TRAFFIC, type TrafficState } from "./commsTraffic";
import type { SystemEntity, SystemEntityStyle } from "./systemEntities";
import { useEntitySelection } from "./useEntitySelection";

type ContributedEntity = Contributed<SystemEntity>;

export interface CommsEntities {
  entities: readonly ContributedEntity[];
  selectedVesselId: string | null;
  selectedEntity: ContributedEntity | null;
  handleEntityActivate: (id: string) => void;
  decorate: (id: string) => SystemEntityStyle | undefined;
  traffic: TrafficState;
  utNow: number | undefined;
}

/**
 * The contributed entities SystemView draws, which one is selected, the comms
 * path that selection lights up, and the command traffic in flight to the
 * active vessel.
 */
export function useCommsEntities({
  activeVesselId,
  activeVesselHasOrbit,
  commsNetwork,
}: {
  activeVesselId: string | undefined;
  activeVesselHasOrbit: boolean;
  commsNetwork: CommsNetwork | undefined;
}): CommsEntities {
  // True-now command-centre bookkeeping, as FleetComms reads it: dispatch-time facts, not delayed telemetry.
  const pendingQueue = useLatestValue<PendingUplinkQueue>(
    "system.uplink.pending",
  );
  const utNow = useUtNow();
  const { showCommlinks, showCommandTraffic } = useFleetCommsToggles();

  // SystemView owns the one piece of dynamic state a contribution cannot: which entity is selected.
  const rawEntities = useContributions("system-view.entities");
  /*
   * The active vessel's own entry is suppressed only while SystemDiagram draws its dedicated ring from `vessel.orbit`, so identity without an orbit never strands a hop endpoint.
   * `showCommlinks` off drops every `connection-line` entity, and the selected-path highlight with them.
   */
  const entities = useMemo(() => {
    const withoutActiveVessel =
      activeVesselId != null && activeVesselHasOrbit
        ? rawEntities.filter((e) => e.vesselId !== activeVesselId)
        : rawEntities;
    return showCommlinks
      ? withoutActiveVessel
      : withoutActiveVessel.filter((e) => e.shape.kind !== "connection-line");
  }, [rawEntities, activeVesselId, activeVesselHasOrbit, showCommlinks]);
  const {
    selectedId: selectedVesselId,
    selectedEntity,
    activate: handleEntityActivate,
  } = useEntitySelection(entities);
  // NO_COMMS_PATH when nothing is selected or the selection carries no vesselId.
  const commsPath = useMemo(
    () =>
      selectedEntity?.vesselId != null
        ? deriveCommsPath(commsNetwork, selectedEntity.vesselId)
        : NO_COMMS_PATH,
    [commsNetwork, selectedEntity],
  );
  const commsPathEdgeIds = useMemo(
    () => new Set(commsPath.edgeIds),
    [commsPath],
  );
  // Coloured by the selected vessel's roster control state, not the traversal quality, so the line agrees with the info panel.
  const commsPathColour = useMemo(
    () => COMMS_PATH_COLOUR[commsControlQuality(selectedEntity?.meta?.comms)],
    [selectedEntity],
  );
  // Every pending entry is addressed to the active vessel (see commsTraffic.ts), independent of selection.
  const traffic = useMemo(
    () =>
      showCommandTraffic
        ? deriveTraffic(
            pendingQueue?.pending ?? [],
            commsNetwork,
            activeVesselId,
            utNow,
          )
        : NO_TRAFFIC,
    [pendingQueue, commsNetwork, activeVesselId, utNow, showCommandTraffic],
  );
  // Brightens the selected entity and colours its path edges; traffic never decorates an edge, since the moving pulse is the only traffic indicator.
  const decorate = useCallback(
    (id: string): SystemEntityStyle | undefined => {
      if (id === selectedVesselId) return { emphasis: "bright" };
      if (commsPathEdgeIds.has(id)) {
        return { emphasis: "bright", colour: commsPathColour };
      }
      return undefined;
    },
    [selectedVesselId, commsPathEdgeIds, commsPathColour],
  );

  return {
    entities,
    selectedVesselId,
    selectedEntity,
    handleEntityActivate,
    decorate,
    traffic,
    utNow,
  };
}
