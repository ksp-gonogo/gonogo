import type { SlotProps } from "@ksp-gonogo/sitrep-sdk";
import { useWidgetScope } from "@ksp-gonogo/ui-kit";
import { useEffect, useRef } from "react";
import { plantSlot, SlotStub, slotStubId } from "./stub";

const BASE_ID = slotStubId("map-view.base");
const BASE_W = 1024;
const BASE_H = 512;

/** A dashed graticule every 30 degrees, handed back as a world-space canvas; the hidden span resolves the theme colour a canvas cannot read. */
function MapBaseStub({ bodyId, onLayer }: SlotProps<"map-view.base">) {
  const colourRef = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const probe = colourRef.current;
    if (!probe) return;
    const canvas = document.createElement("canvas");
    canvas.width = BASE_W;
    canvas.height = BASE_H;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.strokeStyle = getComputedStyle(probe).color;
    ctx.fillStyle = ctx.strokeStyle;
    ctx.lineWidth = 2;
    ctx.setLineDash([8, 6]);
    for (let lon = 0; lon <= 360; lon += 30) {
      const x = (lon / 360) * BASE_W;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, BASE_H);
      ctx.stroke();
    }
    for (let lat = 0; lat <= 180; lat += 30) {
      const y = (lat / 180) * BASE_H;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(BASE_W, y);
      ctx.stroke();
    }
    ctx.font = "28px sans-serif";
    ctx.fillText(`map-view.base: ${bodyId ?? "no body"}`, 16, BASE_H - 24);
    onLayer(BASE_ID, canvas, 1);
    return () => onLayer(BASE_ID, null, 0);
  }, [bodyId, onLayer]);
  return (
    <span
      ref={colourRef}
      hidden
      style={{ color: "var(--color-status-info-fg)" }}
    />
  );
}

/** A dashed box 40 degrees square centred on the vessel (or the origin with no fix), scaled through the slot's own projection so it never straddles the wrap. */
function MapOverlayStub({
  width,
  height,
  project,
  bodyName,
  vesselLat,
  vesselLon,
}: SlotProps<"map-view.overlay">) {
  const centre = project(vesselLat ?? 0, vesselLon ?? 0);
  const origin = project(0, 0);
  const pxPerDegree = Math.abs(project(0, 10).x - origin.x) / 10;
  const half = 20 * pxPerDegree;
  const colour = "var(--color-status-info-fg)";
  return (
    <svg
      data-slot-stub="map-view.overlay"
      width={width}
      height={height}
      aria-hidden="true"
      style={{ position: "absolute", inset: 0 }}
    >
      <rect
        x={centre.x - half}
        y={centre.y - half}
        width={half * 2}
        height={half * 2}
        fill="none"
        stroke={colour}
        strokeDasharray="4 3"
      />
      <circle cx={centre.x} cy={centre.y} r={8} fill="none" stroke={colour} />
      <text
        x={Math.min(centre.x - half, width - 180)}
        y={centre.y - half - 4}
        fill={colour}
        fontSize={11}
      >
        map-view.overlay: {bodyName ?? "no body"}
      </text>
    </svg>
  );
}

function MapSectionsStub() {
  const scope = useWidgetScope("map-view");
  return (
    <SlotStub slot="map-view.sections">
      body: {scope?.bodyName ?? "no scope"}
    </SlotStub>
  );
}

plantSlot("map-view.base", MapBaseStub);
plantSlot("map-view.overlay", MapOverlayStub);
plantSlot("map-view.sections", MapSectionsStub);
plantSlot("map-view.actions");
