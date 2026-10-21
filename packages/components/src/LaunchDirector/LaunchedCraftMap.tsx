import type { PartResources, VesselTopology } from "@ksp-gonogo/core";
import { useTrackedVesselTopology } from "@ksp-gonogo/data";
import type { CatalogEntry } from "@ksp-gonogo/sitrep-sdk";
import { NULL_DISPLAY, SelectableRow } from "@ksp-gonogo/ui-kit";
import { useEffect, useMemo, useState } from "react";
import { ShipDiagramSvg } from "../ShipMap/ShipDiagramSvg";
import { buildShipMapPart, type ShipMapPart } from "../ShipMap/shipTopology";
import { pickView } from "../ShipMap/shipView";
import {
  CraftDiagramFrame,
  CraftDiagramLayer,
  CraftMapLayout,
  CraftNoParts,
  PadList,
  SectionLabel,
  VesselSwitchMeta,
  VesselSwitchName,
} from "./styles";
import { VESSEL_TYPE_LABELS } from "./vesselTypeLabels";

/** The smallest tile that fits a readable map beside the craft names. */
export const CRAFT_MAP_MIN_COLS = 9;
export const CRAFT_MAP_MIN_ROWS = 12;

/**
 * The launched craft, and a side view of the one picked. The view is drawn
 * from the mod's per-craft part tree, so it is as current as the command
 * centre's last word from that craft. It offers no part actions: those act on
 * the vessel being flown.
 */
export function LaunchedCraftMap({
  vessels,
  selectedId,
  onSelect,
}: {
  vessels: readonly CatalogEntry[];
  /** The craft whose map is drawn; null draws none. */
  selectedId: string | null;
  onSelect: (vesselId: string) => void;
}) {
  if (vessels.length === 0) return null;
  return (
    <>
      <SectionLabel>Launched craft</SectionLabel>
      <CraftMapLayout>
        <PadList role="group" aria-label="Launched craft">
          {vessels.map((v) => (
            <SelectableRow
              key={v.vesselId}
              selectedLook="outline"
              data-craft-row={v.vesselId}
              selected={v.vesselId === selectedId}
              onClick={() => onSelect(v.vesselId)}
            >
              <VesselSwitchName>
                <span>{v.name}</span>
                <VesselSwitchMeta>
                  {VESSEL_TYPE_LABELS[v.vesselType] ?? "Unknown"}
                </VesselSwitchMeta>
              </VesselSwitchName>
            </SelectableRow>
          ))}
        </PadList>
        {selectedId && (
          <TrackedCraftDiagram key={selectedId} guid={selectedId} />
        )}
      </CraftMapLayout>
    </>
  );
}

/** Opens the craft's part topic for as long as it is mounted, which is what has the mod measure it. */
function TrackedCraftDiagram({ guid }: { guid: string }) {
  const tracked = useTrackedVesselTopology(guid);
  return (
    <CraftDiagram
      topology={tracked?.topology}
      resourcesByFlightId={tracked?.resourcesByFlightId}
    />
  );
}

/**
 * A craft's side view from a part tree handed in, with nothing bound to the
 * active vessel: no heat, no throttle and no part actions. Crowded parts still
 * open in a box, which changes only the view. Absence of a tree draws the
 * absence dash.
 */
export function CraftDiagram({
  topology,
  resourcesByFlightId,
}: {
  topology: VesselTopology | undefined;
  resourcesByFlightId?: ReadonlyMap<number, PartResources>;
}) {
  const parts: ShipMapPart[] = useMemo(() => {
    if (!topology) return [];
    const view = pickView(topology.parts);
    return topology.parts.map((p) =>
      buildShipMapPart(p, null, resourcesByFlightId?.get(p.flightId), view),
    );
  }, [topology, resourcesByFlightId]);

  const [openClusterId, setOpenClusterId] = useState<string | null>(null);
  const [wrapEl, setWrapEl] = useState<HTMLDivElement | null>(null);
  const [size, setSize] = useState({ w: 240, h: 240 });
  useEffect(() => {
    if (!wrapEl || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) {
        const rect = e.contentRect;
        if (rect.width > 0 && rect.height > 0) {
          setSize({ w: Math.floor(rect.width), h: Math.floor(rect.height) });
        }
      }
    });
    ro.observe(wrapEl);
    return () => ro.disconnect();
  }, [wrapEl]);

  return (
    <CraftDiagramFrame ref={setWrapEl} data-craft-map>
      {parts.length === 0 ? (
        <CraftNoParts role="img" aria-label="No part data for this craft">
          {NULL_DISPLAY}
        </CraftNoParts>
      ) : (
        <CraftDiagramLayer>
          <ShipDiagramSvg
            parts={parts}
            width={size.w}
            height={size.h}
            throttle={0}
            openClusterId={openClusterId}
            onToggleCluster={setOpenClusterId}
          />
        </CraftDiagramLayer>
      )}
    </CraftDiagramFrame>
  );
}
