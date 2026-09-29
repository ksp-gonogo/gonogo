import type { CSSProperties } from "react";
import { useId, useMemo } from "react";
import { FuelLineArrow } from "./FuelLineArrow";
import { anyMeterHeld, HeldHatchPattern, NO_METERS } from "./partMeters";
import { ShipPartGroup } from "./ShipPartGroup";
import { computeShipBaseScale, project } from "./shipLayout";
import type { ShipMapPart, ShipMapPartMeterEntry } from "./shipTopology";

export {
  computeShipLayout,
  SHIP_DIAGRAM_PADDING,
  type ShipBounds,
} from "./shipLayout";

export interface Camera {
  zoom: number;
  panX: number;
  panY: number;
}

const IDENTITY: Camera = { zoom: 1, panX: 0, panY: 0 };

export interface ShipDiagramSvgProps {
  parts: readonly ShipMapPart[];
  width: number;
  height: number;
  /** `ShipMapPart.flightId`, stringified, of the one part to ring. */
  highlightPartId?: string | null;
  highlightColor?: string;
  /** Defaults to identity (zoom=1, pan=0,0): that's what the harness uses. */
  cam?: Camera;
  /** When provided, each part `<g>` becomes interactive. Omit for a static render. */
  onPartHover?: (part: ShipMapPart | null) => void;
  /** Fired on keyboard focus with the part's pre-transform centre, for tooltip placement. */
  onPartFocus?: (part: ShipMapPart, center: { x: number; y: number }) => void;
  /**
   * Fired when a part is activated: left click, Enter/Space, or right click
   * (`contextmenu`, also a touch long-press). Carries the same pre-transform
   * centre as `onPartFocus`. Right click matches KSP's own PAW gesture; left
   * click and Enter make the same surface reachable without a mouse.
   */
  onPartActivate?: (
    part: ShipMapPart,
    center: { x: number; y: number },
  ) => void;
  /** Current throttle (0..1+). Gates engine flames so a staged but idle engine renders no thrust. Defaults to 1. */
  throttle?: number;
  /**
   * Per-part resource meters keyed by stringified `ShipMapPart.flightId`,
   * from the `ship-map.part-meters` slot. An empty or omitted map renders no
   * bars, which is what render paths outside the contribution framework get.
   */
  partMeters?: ReadonlyMap<string, readonly ShipMapPartMeterEntry[]>;
}

/**
 * Pure SVG rendering of the ship diagram, separate from the interactive
 * `ShipDiagram` shell so it renders without zoom/pan state or tooltip chrome.
 */
export function ShipDiagramSvg({
  parts,
  width,
  height,
  highlightPartId,
  highlightColor = "var(--color-tag-yellow-fg)",
  cam = IDENTITY,
  onPartHover,
  onPartFocus,
  onPartActivate,
  throttle = 1,
  partMeters,
}: Readonly<ShipDiagramSvgProps>) {
  const { projected, bounds, stages, edges } = useMemo(
    () => project(parts),
    [parts],
  );
  // useId's colons would need escaping inside url(#...).
  const heldHatchId = `ship-held-hatch-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;

  if (parts.length === 0) {
    return (
      <svg
        width={width}
        height={height}
        role="img"
        aria-label="Ship diagram"
        style={ROOT_SVG_STYLE}
      >
        <text
          x={width / 2}
          y={height / 2}
          textAnchor="middle"
          fill="var(--color-text-dim)"
          fontSize={11}
        >
          No vessel topology yet.
        </text>
      </svg>
    );
  }

  const baseScale = computeShipBaseScale(bounds, width, height);

  const toBase = (lat: number, axial: number) => ({
    x: width / 2 + (lat - bounds.cx) * baseScale,
    y: height / 2 - (axial - bounds.cy) * baseScale,
  });

  const transform = `translate(${cam.panX}, ${cam.panY}) scale(${cam.zoom})`;
  const stroke = (n: number) => n / cam.zoom;

  /* Painter's algorithm: back-to-front by depth, quantised to the mm so float noise does not disturb the tiebreak. Parts at the same depth draw outermost first so the central column overlaps on top. Fuel lines render as arrows in a separate top layer. */
  const drawOrder = [...projected]
    .filter((p) => p.type !== "fuel-line")
    .sort((a, b) => {
      const depthOrder =
        Math.round(a.depth * 1000) - Math.round(b.depth * 1000);
      return depthOrder !== 0 ? depthOrder : b.spineDist - a.spineDist;
    });
  const fuelLines = projected.filter((p) => p.type === "fuel-line");
  const partsById = new Map(projected.map((p) => [p.flightId, p]));

  const interactive = !!onPartHover;

  return (
    <svg
      width={width}
      height={height}
      role={interactive ? "graphics-document" : "img"}
      aria-label="Ship diagram"
      style={ROOT_SVG_STYLE}
    >
      {anyMeterHeld(partMeters) && (
        <defs>
          <HeldHatchPattern id={heldHatchId} zoom={cam.zoom} />
        </defs>
      )}
      <g transform={transform}>
        <line
          x1={toBase(0, bounds.cy + bounds.h / 2 + 0.5).x}
          y1={toBase(0, bounds.cy + bounds.h / 2 + 0.5).y}
          x2={toBase(0, bounds.cy - bounds.h / 2 - 0.5).x}
          y2={toBase(0, bounds.cy - bounds.h / 2 - 0.5).y}
          stroke="var(--color-text-dim)"
          strokeWidth={stroke(1)}
          opacity={0.25}
        />

        {stages.map((axial, i) => {
          const a = toBase(bounds.cx - bounds.w, axial);
          const b = toBase(bounds.cx + bounds.w, axial);
          return (
            <line
              // biome-ignore lint/suspicious/noArrayIndexKey: stages is a flat number[] from a stable derivation; index is the natural id
              key={`stage-${i}-${axial}`}
              x1={a.x}
              y1={a.y}
              x2={b.x}
              y2={b.y}
              stroke="var(--color-text-primary)"
              strokeDasharray={`${stroke(4)} ${stroke(4)}`}
              strokeWidth={stroke(1)}
              opacity={0.18}
            />
          );
        })}

        {edges.map((e) => {
          const a = toBase(e.a.lat, e.a.axial);
          const b = toBase(e.b.lat, e.b.axial);
          return (
            <line
              key={`edge-${e.a.flightId}-${e.b.flightId}`}
              data-edge="parent-child"
              x1={a.x}
              y1={a.y}
              x2={b.x}
              y2={b.y}
              stroke="var(--color-border-strong)"
              strokeWidth={stroke(0.5)}
              opacity={0.5}
            />
          );
        })}

        {drawOrder.map((p) => (
          <ShipPartGroup
            key={p.flightId}
            p={p}
            toBase={toBase}
            cam={cam}
            highlightPartId={highlightPartId}
            highlightColor={highlightColor}
            throttle={throttle}
            meters={partMeters?.get(String(p.flightId)) ?? NO_METERS}
            heldHatchId={heldHatchId}
            interactive={interactive}
            onPartHover={onPartHover}
            onPartFocus={onPartFocus}
            onPartActivate={onPartActivate}
          />
        ))}

        {fuelLines.map((line) => {
          const sourceId = line.parentFlightId;
          const targetId = line.fuelLineTarget ?? null;
          const source = sourceId != null ? partsById.get(sourceId) : null;
          const target = targetId != null ? partsById.get(targetId) : null;
          if (!source || !target) return null;
          const a = toBase(source.lat, source.axial);
          const b = toBase(target.lat, target.axial);
          return (
            <FuelLineArrow
              key={`fuel-line-${line.flightId}`}
              from={a}
              to={b}
              zoom={cam.zoom}
            />
          );
        })}
      </g>
    </svg>
  );
}

// Local sibling ordering inside DiagramWrap's stacking context (above the ambient tint, below the overlay layer), not app-global chrome.
const SVG_LAYER_Z = 1;
const ROOT_SVG_STYLE: CSSProperties = {
  display: "block",
  flex: 1,
  position: "relative",
  zIndex: SVG_LAYER_Z,
};
