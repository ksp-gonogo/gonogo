import type { PartResources, VesselTopology } from "@ksp-gonogo/core";
import { useCraftFileTopology } from "@ksp-gonogo/data";
import { NULL_DISPLAY } from "@ksp-gonogo/ui-kit";
import { useEffect, useMemo, useState } from "react";
import { ShipDiagramSvg } from "../ShipMap/ShipDiagramSvg";
import { buildShipMapPart, type ShipMapPart } from "../ShipMap/shipTopology";
import { pickView } from "../ShipMap/shipView";
import { CraftDiagramFrame, CraftDiagramLayer, CraftNoParts } from "./styles";

/** The smallest tile that fits a readable map beside the craft names. */
export const CRAFT_MAP_MIN_COLS = 9;
export const CRAFT_MAP_MIN_ROWS = 12;

/**
 * The side view of one saved craft file, drawn from the part tree the mod reads
 * out of the file. It opens the file's part topic for as long as it is mounted,
 * which is what has the mod measure the craft. Draws the absence dash until the
 * tree arrives.
 */
export function SavedCraftDiagram({
  facility,
  file,
}: {
  facility: string;
  file: string;
}) {
  const tracked = useCraftFileTopology(facility, file);
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
