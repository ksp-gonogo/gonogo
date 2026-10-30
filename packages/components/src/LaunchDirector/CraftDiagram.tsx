import type { PartResources, VesselTopology } from "@ksp-gonogo/core";
import { useCraftFileTopology } from "@ksp-gonogo/data";
import { NULL_DISPLAY } from "@ksp-gonogo/ui-kit";
import { useEffect, useMemo, useState } from "react";
import { ShipDiagramSvg } from "../ShipMap/ShipDiagramSvg";
import { buildShipMapPart, type ShipMapPart } from "../ShipMap/shipTopology";
import { pickView } from "../ShipMap/shipView";
import { buildStageStack } from "../ShipMap/stageStack";
import { usePartShapes } from "../ShipMap/usePartShapes";
import { CraftStages } from "./CraftStages";
import {
  CraftDiagramFrame,
  CraftDiagramLayer,
  CraftMapColumn,
  CraftNoParts,
} from "./styles";

/** The most pixels a metre of craft draws at in the craft map, so a probe core is not drawn as large as a launch vehicle. */
const CRAFT_MAP_MAX_PX_PER_METRE = 60;

/** The height of the scroll fade a panel draws over the bottom of its body, which hides whatever sits under it. */
const PANEL_BOTTOM_FADE_PX = 44;

/** The smallest tile that fits a readable map beside the craft names. */
export const CRAFT_MAP_MIN_COLS = 7;
export const CRAFT_MAP_MIN_ROWS = 10;

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
  const stages = useCraftStages(tracked?.topology);
  return (
    <CraftMapColumn>
      <CraftDiagram
        topology={tracked?.topology}
        resourcesByFlightId={tracked?.resourcesByFlightId}
      />
      <CraftStages stages={stages} />
    </CraftMapColumn>
  );
}

/**
 * The staging order of one saved craft file, for a tile too small to draw the
 * craft's side view beside its list. Opens the same part topic the side view
 * does, for as long as it is mounted.
 */
export function SavedCraftStages({
  facility,
  file,
}: {
  facility: string;
  file: string;
}) {
  const tracked = useCraftFileTopology(facility, file);
  return <CraftStages stages={useCraftStages(tracked?.topology)} />;
}

function useCraftStages(topology: VesselTopology | undefined) {
  return useMemo(() => {
    if (!topology) return [];
    const view = pickView(topology.parts);
    return buildStageStack(
      topology.parts.map((p) => buildShipMapPart(p, null, undefined, view)),
    );
  }, [topology]);
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
  const { shapes, sources: shapeSources } = usePartShapes(topology?.parts);
  const parts: ShipMapPart[] = useMemo(() => {
    if (!topology) return [];
    const view = pickView(topology.parts);
    return topology.parts.map((p) =>
      buildShipMapPart(
        p,
        null,
        resourcesByFlightId?.get(p.flightId),
        view,
        null,
        p.shape ? shapes.get(p.shape) : undefined,
      ),
    );
  }, [topology, resourcesByFlightId, shapes]);

  const [openClusterId, setOpenClusterId] = useState<string | null>(null);
  const [wrapEl, setWrapEl] = useState<HTMLDivElement | null>(null);
  const [size, setSize] = useState({ w: 240, h: 240 });
  const [roomBelow, setRoomBelow] = useState<number | null>(null);
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
    // The frame is sized by its column's width, so the room left in the scroller below the map's own top is what keeps it inside the tile.
    const body = wrapEl.closest("[data-panel-body]");
    const layout = wrapEl.closest("[data-craft-map-layout]");
    let measure: ResizeObserver | null = null;
    if (body && layout) {
      const fit = () => {
        const top =
          layout.getBoundingClientRect().top -
          body.getBoundingClientRect().top +
          body.scrollTop;
        const bottomInset = Number.parseFloat(
          getComputedStyle(body).paddingBottom,
        );
        const room = Math.floor(
          body.clientHeight -
            top -
            (Number.isFinite(bottomInset) ? bottomInset : 0) -
            PANEL_BOTTOM_FADE_PX,
        );
        setRoomBelow(room > 0 ? room : null);
      };
      measure = new ResizeObserver(fit);
      measure.observe(body);
      measure.observe(layout);
    }
    return () => {
      ro.disconnect();
      measure?.disconnect();
    };
  }, [wrapEl]);

  return (
    <CraftDiagramFrame
      ref={setWrapEl}
      data-craft-map
      style={roomBelow ? { maxHeight: roomBelow } : undefined}
    >
      {shapeSources}
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
            maxScale={CRAFT_MAP_MAX_PX_PER_METRE}
            openClusterId={openClusterId}
            onToggleCluster={setOpenClusterId}
          />
        </CraftDiagramLayer>
      )}
    </CraftDiagramFrame>
  );
}
