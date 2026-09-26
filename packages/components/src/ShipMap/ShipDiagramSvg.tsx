import type { PartStateModule } from "@ksp-gonogo/core";
import type { Reading, Value } from "@ksp-gonogo/sitrep-sdk";
import { resourceColor } from "@ksp-gonogo/ui-kit";
import type React from "react";
import type { CSSProperties } from "react";
import { useMemo } from "react";
// SVG <g> focus ring via `:focus-visible`, which inline style and no ui-kit primitive can express.
// biome-ignore lint/style/noRestrictedImports: SVG <g> focus ring, no inline/primitive equivalent (see above)
import { styled } from "styled-components";
import type {
  PartType,
  ShipMapPart,
  ShipMapPartMeterEntry,
} from "./shipTopology";

/** Empty per-part meter list, shared so a lookup miss doesn't allocate. */
const NO_METERS: readonly ShipMapPartMeterEntry[] = [];

export interface BodyBox {
  latMin: number;
  latMax: number;
  axialMin: number;
  axialMax: number;
}

export interface ProjectedPart extends ShipMapPart {
  body: BodyBox;
  /** Distance from the spine: used for back-to-front draw ordering. */
  spineDist: number;
}

interface Intrinsic {
  /** Half-extent along the axial (spine) axis, in metres. */
  halfH: number;
  /** Half-extent along the lateral axis, in metres. */
  halfW: number;
  /** Tanks, boosters and engines stretch axially to fill stack slabs; everything else keeps its intrinsic size. */
  stretchy: boolean;
}

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

/** Lateral offset under which a child counts as stack-attached. Well under the ~1.25 m stack diameter's radius. */
const STACK_LAT_TOL = 0.3;

/** Screen-space margin (px) reserved around the fit-scaled diagram. */
export const SHIP_DIAGRAM_PADDING = 24;

/** Metre-space fit bounds of the projected vessel (see {@link project}). */
export interface ShipBounds {
  cx: number;
  cy: number;
  w: number;
  h: number;
}

/**
 * Base (identity-camera) metres-to-px scale fitting `bounds` into the
 * viewport with {@link SHIP_DIAGRAM_PADDING}. Shared by the diagram's render
 * and the `ship-map.overlay` slot props so both use one coordinate space.
 */
export function computeShipBaseScale(
  bounds: { w: number; h: number },
  width: number,
  height: number,
): number {
  return Math.min(
    (width - SHIP_DIAGRAM_PADDING * 2) / Math.max(bounds.w, 0.001),
    (height - SHIP_DIAGRAM_PADDING * 2) / Math.max(bounds.h, 0.001),
  );
}

/** The base-frame layout an overlay augment needs to draw in the diagram's space. */
export interface ShipBaseLayout {
  bounds: ShipBounds;
  baseScale: number;
  padding: number;
}

/**
 * The diagram's base-frame layout (fit bounds and scale), exactly as
 * `ShipDiagramSvg` computes it, for the `ship-map.overlay` slot. The live
 * zoom/pan is layered on at render time and is not reflected here.
 */
export function computeShipLayout(
  parts: readonly ShipMapPart[],
  width: number,
  height: number,
): ShipBaseLayout {
  const { bounds } = project(parts);
  return {
    bounds,
    baseScale: computeShipBaseScale(bounds, width, height),
    padding: SHIP_DIAGRAM_PADDING,
  };
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

        {drawOrder.map((p) => {
          const isHot =
            highlightPartId != null && String(p.flightId) === highlightPartId;
          const fill = colorFor(p.type);
          const tint = heatTintFor(
            p.temperatureK,
            p.maxTemperatureK ?? p.maxTemp,
          );
          const a = toBase(p.body.latMin, p.body.axialMax);
          const c = toBase(p.body.latMax, p.body.axialMin);
          const box = {
            x: Math.min(a.x, c.x),
            y: Math.min(a.y, c.y),
            w: Math.abs(c.x - a.x),
            h: Math.abs(c.y - a.y),
          };
          const center = toBase(p.lat, p.axial);
          const outerSign = p.lat >= 0 ? 1 : -1;
          const showFuel = p.type === "tank" || p.type === "booster";
          const meters = partMeters?.get(String(p.flightId)) ?? NO_METERS;

          // Screen-space centre of this part, the anchor for the focus tooltip and the action popover.
          const anchor = {
            x: center.x * cam.zoom + cam.panX,
            y: center.y * cam.zoom + cam.panY,
          };

          const interactiveProps = interactive
            ? {
                tabIndex: 0,
                role: "button",
                "aria-label": partAriaLabel(p, meters),
                onPointerEnter: () => onPartHover?.(p),
                onPointerLeave: () => onPartHover?.(null),
                onFocus: () => {
                  onPartFocus?.(p, anchor);
                  onPartHover?.(p);
                },
                onBlur: () => onPartHover?.(null),
                onClick: () => onPartActivate?.(p, anchor),
                // Right click opens the same menu, with the browser's own context menu suppressed.
                onContextMenu: (e: React.MouseEvent) => {
                  if (!onPartActivate) return;
                  e.preventDefault();
                  onPartActivate(p, anchor);
                },
                // A <g role="button"> gets no native keyboard activation, so Enter/Space are wired here.
                onKeyDown: (e: React.KeyboardEvent) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onPartActivate?.(p, anchor);
                  }
                },
                style: { cursor: "pointer" as const },
              }
            : {};

          /*
           * Solar panels skew rather than rotate, up to 45 degrees: a flat panel
           * seen at an angle projects to a parallelogram with level top and
           * bottom edges. Past 45 degrees the shear blows up toward tan(90) and
           * the panel is really mounted sideways, so it rotates like every other
           * part, whose box and overlays stay locked together.
           */
          const rotateDeg = (p.rotationRad * 180) / Math.PI;
          const cx = center.x.toFixed(2);
          const cy = center.y.toFixed(2);
          const solarSkew = p.type === "solar" && Math.abs(rotateDeg) <= 45;
          const rotateTransform =
            Math.abs(rotateDeg) <= 0.01
              ? undefined
              : solarSkew
                ? `translate(${cx} ${cy}) skewX(${(-rotateDeg).toFixed(2)}) translate(${(-center.x).toFixed(2)} ${(-center.y).toFixed(2)})`
                : `rotate(${rotateDeg.toFixed(2)} ${cx} ${cy})`;

          return (
            <PartGroup
              key={p.flightId}
              transform={rotateTransform}
              {...interactiveProps}
            >
              {renderPartShape(
                p.type,
                box,
                center,
                fill,
                isHot,
                cam.zoom,
                outerSign,
              )}
              {renderPartStateOverlays(p.partState, box, cam.zoom, throttle)}
              {tint && (
                <rect
                  data-role="heat-tint"
                  x={box.x}
                  y={box.y}
                  width={box.w}
                  height={box.h}
                  fill={tint.color}
                  opacity={tint.opacity}
                  pointerEvents="none"
                />
              )}
              {showFuel && renderResourceFill(meters, box)}
              {p.ecFlowSign && !isHot && (
                <rect
                  data-role="ec-flow-ring"
                  x={box.x - 1}
                  y={box.y - 1}
                  width={box.w + 2}
                  height={box.h + 2}
                  fill="none"
                  stroke={
                    p.ecFlowSign === "producer"
                      ? "var(--color-status-go-fg)"
                      : "var(--color-status-warning-bg)"
                  }
                  strokeWidth={stroke(1)}
                  opacity={0.5}
                  rx={2}
                />
              )}
              {isHot && (
                <rect
                  data-role="highlight-ring"
                  data-part-id={p.flightId}
                  x={box.x - 2}
                  y={box.y - 2}
                  width={box.w + 4}
                  height={box.h + 4}
                  fill="none"
                  stroke={highlightColor}
                  strokeWidth={stroke(2)}
                  opacity={0.9}
                  rx={3}
                />
              )}
              {interactive && (
                <rect
                  className="focus-ring"
                  x={box.x - 3}
                  y={box.y - 3}
                  width={box.w + 6}
                  height={box.h + 6}
                  fill="none"
                  stroke="var(--color-accent-fg)"
                  strokeWidth={stroke(2)}
                  rx={3}
                  pointerEvents="none"
                />
              )}
            </PartGroup>
          );
        })}

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

interface FuelLineArrowProps {
  from: { x: number; y: number };
  to: { x: number; y: number };
  zoom: number;
}

function FuelLineArrow({ from, to, zoom }: FuelLineArrowProps) {
  // A stubby pipe in a rotated local frame whose +X points source to target, so the chevrons point along local +X.
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.hypot(dx, dy);
  if (len < 1) return null;
  const angleDeg = (Math.atan2(dy, dx) * 180) / Math.PI;

  const thickness = 16 / zoom;
  const stroke = 0.5 / zoom;
  // Chevrons cluster in the middle so the pipe-end joints stay clean; the stride keeps them reading as discrete arrows.
  const chevronW = 7 / zoom;
  const chevronH = 8 / zoom;
  const chevronStride = 12 / zoom;
  const zoneStart = len * 0.18;
  const zoneEnd = len * 0.82;
  const zoneLen = Math.max(0, zoneEnd - zoneStart);
  const count = Math.max(0, Math.floor(zoneLen / chevronStride));
  const actualStride = count > 0 ? zoneLen / count : 0;
  return (
    <g
      data-role="fuel-line"
      pointerEvents="none"
      transform={`translate(${from.x.toFixed(2)} ${from.y.toFixed(2)}) rotate(${angleDeg.toFixed(2)})`}
    >
      <rect
        x={0}
        y={-thickness / 2}
        width={len}
        height={thickness}
        rx={thickness * 0.35}
        fill="var(--color-tag-yellow-fg)"
        stroke="var(--color-tag-yellow-border)"
        strokeWidth={stroke}
        opacity={0.95}
      />
      {Array.from({ length: count }, (_, i) => {
        const cx = zoneStart + (i + 0.5) * actualStride;
        return (
          <polygon
            // biome-ignore lint/suspicious/noArrayIndexKey: chevrons have no stable identity beyond their order along the pipe
            key={i}
            points={`${cx - chevronW * 0.5},${-chevronH * 0.5} ${cx - chevronW * 0.5},${chevronH * 0.5} ${cx + chevronW * 0.5},0`}
            fill="var(--color-tag-blue-bg)"
            opacity={0.9}
          />
        );
      })}
    </g>
  );
}

interface ScreenBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Indicators driven by live part state: engine flame, parachute canopy,
 * deploy chevron, gear stand. Returns null before any live state, so a
 * pre-push part looks inactive rather than stale-deployed. Drawn in
 * part-local coordinates inside the part's rotation transform.
 */
function renderPartStateOverlays(
  partState: readonly PartStateModule[] | undefined,
  box: ScreenBox,
  zoom: number,
  throttle: number,
): React.ReactNode {
  if (!partState || partState.length === 0) return null;
  const overlays: React.ReactNode[] = [];
  for (const m of partState) {
    const overlay = overlayFor(m, box, zoom, throttle);
    if (overlay) overlays.push(overlay);
  }
  return overlays;
}

function overlayFor(
  m: PartStateModule,
  box: ScreenBox,
  zoom: number,
  throttle: number,
): React.ReactNode {
  switch (m.type) {
    case "engine":
      // "active" means staged and ready, not thrusting: the flame is gated on throttle.
      return m.state === "active" && throttle > 0
        ? renderEngineFlame(box, zoom)
        : null;
    case "parachute":
      return renderParachuteCanopy(box, m.state);
    case "solarPanel":
    case "radiator":
    case "antenna":
      return m.state === "deploying" || m.state === "retracting"
        ? renderAnimatingChevron(box, m.state, zoom)
        : null;
    case "landingGear":
      return m.state === "extended" ? renderLandingGearStand(box, zoom) : null;
    case "cargoBay":
      return m.state === "extended" ? renderCargoBayOpenMark(box, zoom) : null;
    default:
      return null;
  }
}

function renderEngineFlame(box: ScreenBox, zoom: number): React.ReactNode {
  // Flame about 40% of the engine body: outer amber, inner core yellow.
  const { x, y, w, h } = box;
  const flameH = Math.max(h * 0.4, 8 / zoom);
  const top = y + h;
  const inset = w * 0.22;
  const outer = `${x + inset},${top} ${x + w - inset},${top} ${x + w * 0.62},${top + flameH * 0.7} ${x + w * 0.5},${top + flameH} ${x + w * 0.38},${top + flameH * 0.7}`;
  const inner = `${x + inset * 1.4},${top + flameH * 0.18} ${x + w - inset * 1.4},${top + flameH * 0.18} ${x + w * 0.5},${top + flameH * 0.85}`;
  return (
    <g key="engine-flame" data-role="engine-flame" pointerEvents="none">
      <polygon
        points={outer}
        fill="var(--color-status-warning-bg)"
        opacity={0.85}
      />
      <polygon
        points={inner}
        fill="var(--color-tag-yellow-fg)"
        opacity={0.95}
      />
    </g>
  );
}

function renderParachuteCanopy(box: ScreenBox, state: string): React.ReactNode {
  // Canopy grows with deploy progression: armed small, deploying mid, extended full.
  const { x, y, w } = box;
  const cx = x + w / 2;
  let canopyW: number;
  let canopyH: number;
  let opacity: number;
  if (state === "armed") {
    canopyW = w * 0.6;
    canopyH = w * 0.08;
    opacity = 0.5;
  } else if (state === "deploying") {
    canopyW = w * 1.5;
    canopyH = w * 0.45;
    opacity = 0.85;
  } else if (state === "extended") {
    canopyW = w * 2.4;
    canopyH = w * 0.8;
    opacity = 0.95;
  } else {
    return null;
  }
  const baseY = y;
  const apexY = baseY - canopyH;
  const left = cx - canopyW / 2;
  const right = cx + canopyW / 2;
  return (
    <g
      key={`parachute-canopy-${state}`}
      data-role="parachute-canopy"
      pointerEvents="none"
    >
      <path
        d={`M ${left},${baseY} Q ${cx},${apexY - canopyH * 0.3} ${right},${baseY} Z`}
        fill="var(--color-status-nogo-bg)"
        opacity={opacity}
      />
    </g>
  );
}

function renderAnimatingChevron(
  box: ScreenBox,
  state: string,
  zoom: number,
): React.ReactNode {
  // Chevron in the spine-facing corner while a deploy or retract animation is in flight.
  const { x, y, w, h } = box;
  const size = Math.max(4 / zoom, Math.min(w, h) * 0.18);
  const ax = x + w - size - 1;
  const ay = y + 1;
  const points =
    state === "deploying"
      ? `${ax},${ay + size} ${ax + size},${ay + size} ${ax + size / 2},${ay}`
      : `${ax},${ay} ${ax + size},${ay} ${ax + size / 2},${ay + size}`;
  return (
    <g
      key={`anim-chevron-${state}`}
      data-role="anim-chevron"
      pointerEvents="none"
    >
      <polygon
        points={points}
        fill="var(--color-tag-yellow-fg)"
        opacity={0.85}
      />
    </g>
  );
}

function renderLandingGearStand(box: ScreenBox, zoom: number): React.ReactNode {
  // A short tick under the body box: gear is down.
  const { x, y, w, h } = box;
  const standH = Math.max(3 / zoom, h * 0.18);
  return (
    <line
      key="gear-stand"
      data-role="gear-stand"
      x1={x + w * 0.3}
      y1={y + h}
      x2={x + w * 0.7}
      y2={y + h + standH}
      stroke="var(--color-status-go-fg)"
      strokeWidth={2 / zoom}
      strokeLinecap="round"
      pointerEvents="none"
    />
  );
}

function renderCargoBayOpenMark(box: ScreenBox, zoom: number): React.ReactNode {
  // Dashed inset rect: cargo-bay doors are open.
  const { x, y, w, h } = box;
  const inset = Math.min(w, h) * 0.12;
  return (
    <rect
      key="cargo-bay-open"
      data-role="cargo-bay-open"
      x={x + inset}
      y={y + inset}
      width={w - inset * 2}
      height={h - inset * 2}
      fill="none"
      stroke="var(--color-status-go-fg)"
      strokeWidth={1.5 / zoom}
      strokeDasharray={`${4 / zoom} ${3 / zoom}`}
      opacity={0.8}
      pointerEvents="none"
    />
  );
}

function renderPartShape(
  type: PartType,
  box: ScreenBox,
  center: { x: number; y: number },
  fill: string,
  isHot: boolean,
  zoom: number,
  outerSign: number,
) {
  const stroke = isHot
    ? "var(--color-tag-yellow-fg)"
    : "var(--color-text-inverse)";
  const strokeWidth = (isHot ? 1.5 : 0.5) / zoom;
  const opacity = 0.95;
  const { x, y, w, h } = box;
  const cx = center.x;
  const cy = center.y;

  switch (type) {
    case "engine": {
      // Bell height from width, capped at half the body, so a tall engine grows its mounting block rather than its bell.
      const bellH = Math.min(h * 0.5, w * 0.55);
      const blockH = h - bellH;
      const bellTopInset = w * 0.12;
      return (
        <g>
          <rect
            x={x}
            y={y}
            width={w}
            height={blockH}
            fill={fill}
            stroke={stroke}
            strokeWidth={strokeWidth}
            opacity={opacity}
          />
          <polygon
            points={`${x + bellTopInset},${y + blockH} ${x + w - bellTopInset},${
              y + blockH
            } ${x + w},${y + h} ${x},${y + h}`}
            fill={fill}
            stroke={stroke}
            strokeWidth={strokeWidth}
            opacity={opacity}
          />
        </g>
      );
    }
    case "booster":
      return (
        <rect
          x={x}
          y={y}
          width={w}
          height={h}
          rx={Math.min(w, h) * 0.06}
          fill={fill}
          stroke={stroke}
          strokeWidth={strokeWidth}
          opacity={opacity}
        />
      );
    case "tank":
      return (
        <rect
          x={x}
          y={y}
          width={w}
          height={h}
          rx={Math.min(w, h) * 0.1}
          fill={fill}
          stroke={stroke}
          strokeWidth={strokeWidth}
          opacity={opacity}
        />
      );
    case "decoupler": {
      // Stack decouplers (wide, short) are thin discs; radial ones (tall, narrow) take the full body extent to bridge the gap to the side stack.
      if (w >= h) {
        const thickness = Math.max(4 / zoom, Math.min(h, 12 / zoom));
        return (
          <rect
            x={x}
            y={cy - thickness / 2}
            width={w}
            height={thickness}
            fill={fill}
            stroke={stroke}
            strokeWidth={strokeWidth}
            opacity={opacity}
          />
        );
      }
      return (
        <rect
          x={x}
          y={y}
          width={w}
          height={h}
          rx={Math.min(w, h) * 0.08}
          fill={fill}
          stroke={stroke}
          strokeWidth={strokeWidth}
          opacity={opacity}
        />
      );
    }
    case "wheel": {
      // Radius takes the smaller half-extent so the wheel never overflows its box.
      const r = Math.min(w, h) / 2;
      return (
        <circle
          cx={cx}
          cy={cy}
          r={r}
          fill={fill}
          stroke={stroke}
          strokeWidth={strokeWidth}
          opacity={opacity}
        />
      );
    }
    case "fin": {
      /* Stylised swept winglet fitted to the bounding box (no mesh outline): aft is screen-down and KSP winglets sweep aft, so a vertical root edge on the spine side, a swept leading edge, a short tip chord and the full-span trailing edge along the bottom. */
      const rootX = outerSign >= 0 ? x : x + w;
      const tipX = outerSign >= 0 ? x + w : x;
      const tipLeadY = y + h * 0.7;
      return (
        <polygon
          points={`${rootX},${y} ${tipX},${tipLeadY} ${tipX},${y + h} ${rootX},${y + h}`}
          fill={fill}
          stroke={stroke}
          strokeWidth={strokeWidth}
          opacity={opacity * 0.9}
        />
      );
    }
    case "rcs":
      return (
        <ellipse
          cx={cx}
          cy={cy}
          rx={Math.max(2, w * 0.45)}
          ry={Math.max(2, h * 0.45)}
          fill={fill}
          stroke={stroke}
          strokeWidth={strokeWidth}
          opacity={opacity}
        />
      );
    case "capsule": {
      // Frustum reaching the bounds top, so a part mounted above visually touches.
      const topInset = w * 0.18;
      return (
        <polygon
          points={`${x},${y + h} ${x + w},${y + h} ${x + w - topInset},${y} ${x + topInset},${y}`}
          fill={fill}
          stroke={stroke}
          strokeWidth={strokeWidth}
          opacity={opacity}
        />
      );
    }
    case "nose-cone": {
      // Cubic Bezier with both control points at y, tangent to the top edge at the peak.
      return (
        <path
          d={`M ${x} ${y + h} L ${x} ${y + h * 0.4} C ${x} ${y} ${x + w} ${y} ${x + w} ${y + h * 0.4} L ${x + w} ${y + h} Z`}
          fill={fill}
          stroke={stroke}
          strokeWidth={strokeWidth}
          opacity={opacity}
        />
      );
    }
    case "solar": {
      // The box already carries azimuth foreshortening; the minor dimension is floored so an edge-on panel stays a hairline.
      const minDim = 3 / zoom;
      const rw = Math.max(w, minDim);
      const rh = Math.max(h, minDim);
      return (
        <rect
          x={cx - rw / 2}
          y={cy - rh / 2}
          width={rw}
          height={rh}
          fill={fill}
          stroke={stroke}
          strokeWidth={strokeWidth}
          opacity={opacity * 0.9}
        />
      );
    }
    case "parachute": {
      // Stowed canister: a squat dome, inset because the canister is smaller than its mounted footprint.
      const inset = w * 0.18;
      const baseY = y + h * 0.85;
      return (
        <path
          d={`M ${x + inset},${baseY} L ${x + inset},${y + h * 0.45} C ${x + inset},${y} ${x + w - inset},${y} ${x + w - inset},${y + h * 0.45} L ${x + w - inset},${baseY} Z`}
          fill={fill}
          stroke={stroke}
          strokeWidth={strokeWidth}
          opacity={opacity}
        />
      );
    }
    default:
      return (
        <rect
          x={x}
          y={y}
          width={w}
          height={h}
          fill={fill}
          stroke={stroke}
          strokeWidth={strokeWidth}
          opacity={opacity * 0.85}
        />
      );
  }
}

/**
 * Status as a border tint on the bar's track, never a fill hue: the fill is
 * the resource's identity colour, so resource and condition stay separately
 * legible.
 */
const STATUS_BORDER: Record<"low" | "critical", string> = {
  low: "var(--color-status-warning-bg)",
  critical: "var(--color-status-nogo-bg)",
};

function colorFor(type: PartType): string {
  switch (type) {
    case "engine":
      return "var(--color-status-warning-bg)";
    case "booster":
      return "var(--color-status-warning-bg)";
    case "tank":
      return "var(--color-text-muted)";
    case "decoupler":
      return "var(--color-status-warning-bg)";
    case "nose-cone":
      return "var(--color-text-primary)";
    case "fin":
      return "var(--color-status-info-fg)";
    case "rcs":
      return "var(--color-text-primary)";
    case "capsule":
      return "var(--color-text-primary)";
    case "solar":
      return "var(--color-status-info-fg)";
    case "parachute":
      return "var(--color-status-nogo-bg)";
    case "wheel":
      return "var(--color-text-muted)";
    default:
      return "var(--color-text-muted)";
  }
}

/**
 * The quantity a part-meter row carries, on either value-bearing arm: this
 * site draws a fill bar, so a held figure is still drawn.
 */
function quantityOf(
  figure: Value<"units"> | Reading<Value<"units">>,
): Value<"units"> | undefined {
  if (!("state" in figure)) return figure;
  return figure.state === "observed" || figure.state === "stale"
    ? figure.value
    : undefined;
}

/**
 * Whether a row's level is the last one there was rather than the tank now.
 * Only a contributor that sends the whole reading can say so; a bare quantity
 * claims nothing about when it was read.
 */
function isHeld(row: ShipMapPartMeterEntry): boolean {
  return "state" in row.amount && row.amount.state === "stale";
}

/**
 * The fill, 0..1. `dividedBy` checks the two are the same kind, so the
 * magnitude taken is already dimensionless; an SVG length cannot hold a unit.
 */
function fillRatio(row: ShipMapPartMeterEntry): number | null {
  const amount = quantityOf(row.amount);
  const capacity = quantityOf(row.capacity);
  if (!amount || !capacity || !capacity.isPositive()) return null;
  return Math.max(0, Math.min(1, amount.dividedBy(capacity).magnitude));
}

/**
 * The compact in-body fill bars, one segment per contributed meter, as raw
 * SVG rects. `ShipDiagram`'s tooltip renders the same entries through `<Meter>`.
 */
function renderResourceFill(
  meters: readonly ShipMapPartMeterEntry[],
  box: ScreenBox,
): React.ReactNode {
  const drainable = meters.filter((m) => fillRatio(m) !== null);
  if (drainable.length === 0) return null;

  const padX = Math.max(2, box.w * 0.18);
  const padY = Math.max(2, box.h * 0.08);
  const innerW = box.w - padX * 2;
  const innerH = box.h - padY * 2;
  if (innerW <= 0 || innerH <= 0) return null;
  const gap = 1;
  const barW = (innerW - gap * (drainable.length - 1)) / drainable.length;
  if (barW <= 0) return null;

  return (
    <g pointerEvents="none">
      {drainable.map((m, i) => {
        const ratio = fillRatio(m) ?? 0;
        const fillH = innerH * ratio;
        const barX = box.x + padX + i * (barW + gap);
        const barTop = box.y + padY + (innerH - fillH);
        // Status tints the track, never the fill, which is always the resource's identity colour.
        const statusBorder = m.status ? STATUS_BORDER[m.status] : undefined;
        // A held level is drawn faded inside a dashed track: still the last level there was, and visibly not the tank now.
        const held = isHeld(m);
        return (
          <g key={m.resource}>
            <rect
              x={barX}
              y={box.y + padY}
              width={barW}
              height={innerH}
              fill="var(--color-surface-raised)"
              opacity={0.35}
              stroke={
                statusBorder ?? (held ? "var(--color-text-muted)" : undefined)
              }
              strokeWidth={statusBorder || held ? 1 : 0}
              strokeDasharray={held ? "2 1" : undefined}
              strokeOpacity={0.9}
            />
            <rect
              x={barX}
              y={barTop}
              width={barW}
              height={fillH}
              fill={resourceColor(m.resource)}
              opacity={held ? 0.4 : 0.85}
            />
          </g>
        );
      })}
    </g>
  );
}

export function partAriaLabel(
  p: ShipMapPart,
  meters: readonly ShipMapPartMeterEntry[] = NO_METERS,
): string {
  const name = p.title || p.name;
  const bits: string[] = [name, p.type, `${p.dryMass.toFixed(2)} tonnes`];
  for (const m of meters) {
    const ratio = fillRatio(m);
    if (ratio === null) continue;
    bits.push(
      `${m.displayName} ${Math.round(ratio * 100)} percent${isHeld(m) ? ", held" : ""}`,
    );
  }
  const maxK = p.maxTemperatureK ?? p.maxTemp;
  if (p.temperatureK !== undefined && maxK > 0) {
    const ratio = p.temperatureK / maxK;
    if (ratio > 0.75) bits.push("hot");
  }
  return bits.join(", ");
}

/**
 * Heat tint colour and opacity for a part, or null when comfortably cold.
 * Below 50% of maxTemp nothing; 50-80% amber up to about 0.5 opacity; 80-100%
 * red at 0.55-0.85. A rect over the body rather than a blended fill, so the
 * colours stay CSS-variable driven.
 */
function heatTintFor(
  temp: number | undefined,
  maxTemp: number,
): { color: string; opacity: number } | null {
  if (!temp || maxTemp <= 0) return null;
  const t = Math.max(0, Math.min(1, temp / maxTemp));
  if (t < 0.5) return null;
  if (t < 0.8) {
    return {
      color: "var(--color-status-warning-bg)",
      opacity: ((t - 0.5) / 0.3) * 0.5,
    };
  }
  return {
    color: "var(--color-status-nogo-bg)",
    opacity: 0.55 + ((t - 0.8) / 0.2) * 0.3,
  };
}

/** Metre-space margin below an active engine for its flame, mirroring `renderEngineFlame`'s 0.4 body height. */
function engineFlameReach(p: ShipMapPart, axialExtent: number): number {
  if (p.type !== "engine") return 0;
  const firing = p.partState?.some(
    (m) => m.type === "engine" && m.state === "active",
  );
  return firing ? axialExtent * 0.4 : 0;
}

/** Metre-space margin above a parachute for its canopy, reserved only for the states that render one. */
function parachuteCanopyReach(p: ShipMapPart, latExtent: number): number {
  if (p.type !== "parachute") return 0;
  const state = p.partState?.find((m) => m.type === "parachute")?.state;
  if (state === "extended") return latExtent * 0.8;
  if (state === "deploying") return latExtent * 0.45;
  if (state === "armed") return latExtent * 0.08;
  return 0;
}

function intrinsicSize(part: ShipMapPart): Intrinsic {
  const stretchy =
    part.type === "tank" || part.type === "booster" || part.type === "engine";
  return {
    halfH: part.axialHalfExtent,
    halfW: part.latHalfExtent,
    stretchy,
  };
}

function project(parts: readonly ShipMapPart[]) {
  if (parts.length === 0) {
    return {
      projected: [] as ProjectedPart[],
      stages: [] as number[],
      edges: [] as { a: ProjectedPart; b: ProjectedPart }[],
      bounds: { cx: 0, cy: 0, w: 1, h: 1 },
    };
  }

  const intrinsics = new Map<number, Intrinsic>(
    parts.map((p) => [p.flightId, intrinsicSize(p)]),
  );
  const byId = new Map(parts.map((p) => [p.flightId, p]));
  const childrenOf = new Map<number, ShipMapPart[]>();
  for (const p of parts) {
    if (p.parentFlightId == null) continue;
    const list = childrenOf.get(p.parentFlightId) ?? [];
    list.push(p);
    childrenOf.set(p.parentFlightId, list);
  }

  const projected: ProjectedPart[] = parts.map((p) =>
    withBody(p, byId, childrenOf, intrinsics),
  );

  const stages = projected
    .filter((p) => p.type === "decoupler")
    .map((p) => p.axial);

  const edges: { a: ProjectedPart; b: ProjectedPart }[] = [];
  const projById = new Map(projected.map((p) => [p.flightId, p]));
  for (const p of projected) {
    if (p.parentFlightId == null) continue;
    const parent = projById.get(p.parentFlightId);
    if (parent) edges.push({ a: p, b: parent });
  }

  let minL = Infinity;
  let maxL = -Infinity;
  let minA = Infinity;
  let maxA = -Infinity;
  for (const p of projected) {
    minL = Math.min(minL, p.body.latMin);
    maxL = Math.max(maxL, p.body.latMax);
    // Flames and canopies escape the body box, so the same fraction of the metre-space extent is reserved or they clip at fit zoom.
    const axialExtent = p.body.axialMax - p.body.axialMin;
    const latExtent = p.body.latMax - p.body.latMin;
    minA = Math.min(minA, p.body.axialMin - engineFlameReach(p, axialExtent));
    maxA = Math.max(maxA, p.body.axialMax + parachuteCanopyReach(p, latExtent));
  }
  const w = Math.max(maxL - minL, 1);
  const h = Math.max(maxA - minA, 1);
  return {
    projected,
    stages,
    edges,
    bounds: { cx: (minL + maxL) / 2, cy: (minA + maxA) / 2, w, h },
  };
}

function withBody(
  p: ShipMapPart,
  byId: Map<number, ShipMapPart>,
  childrenOf: Map<number, ShipMapPart[]>,
  intrinsics: Map<number, Intrinsic>,
): ProjectedPart {
  const intr = intrinsics.get(p.flightId);
  if (!intr)
    throw new Error(`ShipDiagram: missing intrinsic for ${p.flightId}`);
  const parent =
    p.parentFlightId != null ? (byId.get(p.parentFlightId) ?? null) : null;
  const children = childrenOf.get(p.flightId) ?? [];

  const isStackAxial = (c: ShipMapPart) =>
    Math.abs(c.lat - p.lat) < STACK_LAT_TOL &&
    Math.abs(c.axial - p.axial) > 0.05;

  const stackParent = parent && isStackAxial(parent) ? parent : null;
  const stackChildAbove = children
    .filter((c) => isStackAxial(c) && c.axial > p.axial)
    .reduce<ShipMapPart | null>(
      (m, c) => (!m || c.axial > m.axial ? c : m),
      null,
    );
  const stackChildBelow = children
    .filter((c) => isStackAxial(c) && c.axial < p.axial)
    .reduce<ShipMapPart | null>(
      (m, c) => (!m || c.axial < m.axial ? c : m),
      null,
    );

  let axialMax = p.axial + intr.halfH;
  let axialMin = p.axial - intr.halfH;

  if (intr.stretchy) {
    const upper =
      stackParent && stackParent.axial > p.axial
        ? stackParent
        : stackChildAbove;
    const lower =
      stackParent && stackParent.axial < p.axial
        ? stackParent
        : stackChildBelow;
    if (upper) {
      const ui = intrinsics.get(upper.flightId);
      if (ui) {
        axialMax = ui.stretchy
          ? (p.axial + upper.axial) / 2
          : upper.axial - ui.halfH;
      }
    }
    if (lower) {
      const li = intrinsics.get(lower.flightId);
      if (li) {
        axialMin = li.stretchy
          ? (p.axial + lower.axial) / 2
          : lower.axial + li.halfH;
      }
    }
  }

  let latMin = p.lat - intr.halfW;
  let latMax = p.lat + intr.halfW;
  for (const c of children) {
    if (isStackAxial(c)) continue;
    const ci = intrinsics.get(c.flightId);
    if (!ci) continue;
    if (c.type !== "fin" && c.type !== "solar") {
      if (c.axial + ci.halfH > axialMax) axialMax = c.axial + ci.halfH;
      if (c.axial - ci.halfH < axialMin) axialMin = c.axial - ci.halfH;
    }
    if (
      Math.abs(c.lat - p.lat) > 0.05 &&
      c.type !== "fin" &&
      c.type !== "solar"
    ) {
      const sign = Math.sign(c.lat - p.lat);
      const innerEdge = c.lat - sign * ci.halfW;
      if (sign > 0 && innerEdge > latMax) latMax = innerEdge;
      if (sign < 0 && innerEdge < latMin) latMin = innerEdge;
    }
  }

  if (p.type === "decoupler") {
    const widthOf = (n: ShipMapPart | null) =>
      n ? (intrinsics.get(n.flightId)?.halfW ?? 0) : 0;
    const halfW = Math.max(
      intr.halfW,
      widthOf(stackParent),
      widthOf(stackChildAbove),
      widthOf(stackChildBelow),
    );
    latMin = p.lat - halfW;
    latMax = p.lat + halfW;
  }

  return {
    ...p,
    body: { latMin, latMax, axialMin, axialMax },
    spineDist: Math.abs(p.lat),
  };
}

// Local sibling ordering inside DiagramWrap's stacking context (above the ambient tint, below the overlay layer), not app-global chrome.
const SVG_LAYER_Z = 1;
const ROOT_SVG_STYLE: CSSProperties = {
  display: "block",
  flex: 1,
  position: "relative",
  zIndex: SVG_LAYER_Z,
};

const PartGroup = styled.g`
  outline: none;
  .focus-ring {
    visibility: hidden;
  }
  &:focus-visible .focus-ring {
    visibility: visible;
  }
`;
