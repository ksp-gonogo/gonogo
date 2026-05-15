import type React from "react";
import { useMemo } from "react";
import { styled } from "styled-components";
import type { PartType, ShipMapPart } from "./shipTopology";

export interface BodyBox {
  latMin: number;
  latMax: number;
  axialMin: number;
  axialMax: number;
}

export interface ProjectedPart extends ShipMapPart {
  body: BodyBox;
  /** Distance from the spine — used for back-to-front draw ordering. */
  spineDist: number;
}

interface Intrinsic {
  /** Half-extent along the axial (spine) axis, in metres. */
  halfH: number;
  /** Half-extent along the lateral axis, in metres. */
  halfW: number;
  /** Tanks/boosters/engines stretch axially to fill stack slabs; everything
   *  else stays at its intrinsic size so decouplers, fins, etc. don't
   *  inflate to fill huge gaps. */
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
  /** Case-insensitive part name or title to highlight. Matched against
   *  both `name` and `title`. */
  highlight?: string | null;
  highlightColor?: string;
  /** Defaults to identity (zoom=1, pan=0,0) — that's what the harness uses. */
  cam?: Camera;
  /** When provided, each part `<g>` becomes interactive (tabIndex/role/aria
   *  + pointer + focus handlers). Omit for a static / harness render. */
  onPartHover?: (part: ShipMapPart | null) => void;
  /** Fired on keyboard focus with the focused part's pre-transform centre,
   *  so the parent can position a tooltip near it. */
  onPartFocus?: (part: ShipMapPart, center: { x: number; y: number }) => void;
}

/** Lateral offset under which a child counts as "stack-attached" rather
 *  than side-mounted. KSP stack diameters are ~1.25m; 0.3m is well
 *  under the radius so axial-stack joints don't get misclassified. */
const STACK_LAT_TOL = 0.3;

/** Floor on bounds extents so a zero-bounds part (rare, mid-load) doesn't
 *  collapse to a point and break the projection. ~0.1m mirrors the smallest
 *  real KSP part size. */
const MIN_HALF_EXTENT = 0.1;

/**
 * Pure SVG rendering of the ship diagram. Separated from the interactive
 * `ShipDiagram` shell (Wrapper/Reset/Tooltip) so the harness + snapshot
 * tests can render the same SVG without spinning up zoom/pan state, a
 * jsdom mouse, or any tooltip chrome.
 */
export function ShipDiagramSvg({
  parts,
  width,
  height,
  highlight,
  highlightColor = "var(--color-tag-yellow-fg)",
  cam = IDENTITY,
  onPartHover,
  onPartFocus,
}: Readonly<ShipDiagramSvgProps>) {
  const { projected, bounds, stages, edges } = useMemo(
    () => project(parts),
    [parts],
  );

  if (parts.length === 0) {
    return (
      <svg width={width} height={height} role="img" aria-label="Ship diagram">
        <text
          x={width / 2}
          y={height / 2}
          textAnchor="middle"
          fill="var(--color-text-dim)"
          fontSize={11}
        >
          No vessel topology yet — waiting for Telemachus.
        </text>
      </svg>
    );
  }

  const padding = 24;
  const baseScale = Math.min(
    (width - padding * 2) / Math.max(bounds.w, 0.001),
    (height - padding * 2) / Math.max(bounds.h, 0.001),
  );

  const toBase = (lat: number, axial: number) => ({
    x: width / 2 + (lat - bounds.cx) * baseScale,
    y: height / 2 - (axial - bounds.cy) * baseScale,
  });

  const transform = `translate(${cam.panX}, ${cam.panY}) scale(${cam.zoom})`;
  const stroke = (n: number) => n / cam.zoom;

  // Draw outer parts first so the central stack overlaps cleanly on top.
  const drawOrder = [...projected].sort((a, b) => b.spineDist - a.spineDist);

  const interactive = !!onPartHover;

  return (
    <svg width={width} height={height} role="img" aria-label="Ship diagram">
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
            !!highlight &&
            (p.title.toLowerCase() === highlight.toLowerCase() ||
              p.name.toLowerCase() === highlight.toLowerCase());
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

          const interactiveProps = interactive
            ? {
                tabIndex: 0,
                role: "button",
                "aria-label": partAriaLabel(p),
                onPointerEnter: () => onPartHover?.(p),
                onPointerLeave: () => onPartHover?.(null),
                onFocus: () => {
                  onPartFocus?.(p, {
                    x: center.x * cam.zoom + cam.panX,
                    y: center.y * cam.zoom + cam.panY,
                  });
                  onPartHover?.(p);
                },
                onBlur: () => onPartHover?.(null),
                style: { cursor: "pointer" as const },
              }
            : {};

          return (
            <PartGroup key={p.flightId} {...interactiveProps}>
              {renderPartShape(
                p.type,
                box,
                center,
                fill,
                isHot,
                cam.zoom,
                outerSign,
              )}
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
              {showFuel && renderResourceFill(p.resources, box)}
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
      </g>
    </svg>
  );
}

interface ScreenBox {
  x: number;
  y: number;
  w: number;
  h: number;
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
      // Bell height is derived from width, not body height — so a
      // stretched-tall engine grows its mounting block, not a giant
      // trapezoid. Cap at half the body so very short engines still
      // get a recognisable bell.
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
      // Always thin, wide as the stack — width comes from the body box
      // (which inherited from neighbouring stack parts during projection).
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
    case "fin": {
      // Outward-pointing triangle: wide base on the spine-side of the
      // body box, tip pointing away from the spine.
      const baseX = outerSign >= 0 ? x : x + w;
      const tipX = outerSign >= 0 ? x + w : x;
      return (
        <polygon
          points={`${baseX},${y} ${baseX},${y + h} ${tipX},${y + h * 0.5}`}
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
    case "capsule":
      return (
        <path
          d={`M ${x} ${y + h} L ${x} ${y + h * 0.4} Q ${cx} ${y} ${
            x + w
          } ${y + h * 0.4} L ${x + w} ${y + h} Z`}
          fill={fill}
          stroke={stroke}
          strokeWidth={strokeWidth}
          opacity={opacity}
        />
      );
    case "solar": {
      // Wide thin strip — solar panels are skinny.
      const thickness = Math.max(4 / zoom, Math.min(h, 8 / zoom));
      return (
        <rect
          x={x}
          y={cy - thickness / 2}
          width={w}
          height={thickness}
          fill={fill}
          stroke={stroke}
          strokeWidth={strokeWidth}
          opacity={opacity * 0.9}
        />
      );
    }
    case "parachute":
      return (
        <rect
          x={x + w * 0.2}
          y={y + h * 0.15}
          width={w * 0.6}
          height={h * 0.7}
          rx={Math.min(w, h) * 0.15}
          fill={fill}
          stroke={stroke}
          strokeWidth={strokeWidth}
          opacity={opacity}
        />
      );
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

/** Resources we're willing to draw as a fuel-fill bar. ElectricCharge,
 *  Ablator, etc. are deliberately excluded — they'd add bars to most
 *  parts without being meaningful at a glance. */
const DRAINABLE = new Set([
  "LiquidFuel",
  "Oxidizer",
  "SolidFuel",
  "MonoPropellant",
  "XenonGas",
]);

function resourceColor(name: string): string {
  switch (name) {
    case "LiquidFuel":
      return "var(--color-accent-fg)";
    case "Oxidizer":
      return "var(--color-status-info-fg)";
    case "SolidFuel":
      return "var(--color-status-warning-bg)";
    case "MonoPropellant":
      return "var(--color-status-warning-bg)";
    case "XenonGas":
      return "var(--color-tag-cyan-fg)";
    default:
      return "var(--color-text-muted)";
  }
}

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
    default:
      return "var(--color-text-muted)";
  }
}

function renderResourceFill(
  resources: ShipMapPart["resources"],
  box: ScreenBox,
): React.ReactNode {
  if (!resources || resources.length === 0) return null;
  const drainable = resources.filter((r) => DRAINABLE.has(r.n) && r.c > 0);
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
      {drainable.map((r, i) => {
        const ratio = Math.max(0, Math.min(1, r.a / r.c));
        const fillH = innerH * ratio;
        const barX = box.x + padX + i * (barW + gap);
        const barTop = box.y + padY + (innerH - fillH);
        return (
          <g key={r.n}>
            <rect
              x={barX}
              y={box.y + padY}
              width={barW}
              height={innerH}
              fill="var(--color-surface-raised)"
              opacity={0.35}
            />
            <rect
              x={barX}
              y={barTop}
              width={barW}
              height={fillH}
              fill={resourceColor(r.n)}
              opacity={0.85}
            />
          </g>
        );
      })}
    </g>
  );
}

export function partAriaLabel(p: ShipMapPart): string {
  const name = p.title || p.name;
  const bits: string[] = [name, p.type, `${p.dryMass.toFixed(2)} tonnes`];
  if (p.resources) {
    const drainable = p.resources.filter((r) => DRAINABLE.has(r.n) && r.c > 0);
    for (const r of drainable) {
      const pct = Math.round((r.a / r.c) * 100);
      bits.push(`${r.n} ${pct} percent`);
    }
  }
  const maxK = p.maxTemperatureK ?? p.maxTemp;
  if (p.temperatureK !== undefined && maxK > 0) {
    const ratio = p.temperatureK / maxK;
    if (ratio > 0.75) bits.push("hot");
  }
  return bits.join(", ");
}

/**
 * Heat indicator overlay for a part. Returns the colour + opacity to
 * paint over the part's body, or null when the part is comfortably cold.
 *
 * Ramp:
 * - < 50% of maxTemp: nothing — most parts hover near ambient.
 * - 50–80%: amber overlay growing from 0 to ~0.5 opacity.
 * - 80–100%: red overlay at 0.55–0.85 opacity, signalling imminent
 *   structural failure.
 *
 * Rendered as a plain `<rect>` over the part's body box rather than
 * blending the base fill, so the colours stay CSS-variable driven (no
 * resolved-hex palette duplicated in component code) and the visual
 * read is bolder at high temperatures than a subtle blend would give.
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

function intrinsicSize(part: ShipMapPart): Intrinsic {
  const s = part.size;
  const halfH = Math.max(s.z / 2, MIN_HALF_EXTENT);
  const halfW = Math.max(Math.max(s.x, s.y) / 2, MIN_HALF_EXTENT);
  const stretchy =
    part.type === "tank" || part.type === "booster" || part.type === "engine";
  return { halfH, halfW, stretchy };
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
    minA = Math.min(minA, p.body.axialMin);
    maxA = Math.max(maxA, p.body.axialMax);
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

const PartGroup = styled.g`
  outline: none;
  .focus-ring {
    visibility: hidden;
  }
  &:focus-visible .focus-ring {
    visibility: visible;
  }
`;
