import type React from "react";
import { useMemo, useState } from "react";
import styled from "styled-components";
import { useZoomPan } from "../shared/useZoomPan";
import type { ShipMapPart } from "./shipMapScript";

type PartType =
  | "engine"
  | "booster"
  | "tank"
  | "decoupler"
  | "fin"
  | "rcs"
  | "capsule"
  | "solar"
  | "parachute"
  | "other";

interface BodyBox {
  latMin: number;
  latMax: number;
  axialMin: number;
  axialMax: number;
}

interface ProjectedPart extends ShipMapPart {
  lat: number;
  axial: number;
  type: PartType;
  body: BodyBox;
  /** Distance from the spine — used for back-to-front draw ordering. */
  spineDist: number;
}

interface BasePart extends ShipMapPart {
  lat: number;
  axial: number;
  type: PartType;
}

interface Intrinsic {
  /** Half-height in world units (axial). */
  halfH: number;
  /** Half-width in world units (lateral). */
  halfW: number;
  /** Tanks/boosters stretch axially to fill their stack slab; everything
   *  else stays at its intrinsic size so engines, decouplers, etc. don't
   *  inflate to fill huge gaps. */
  stretchy: boolean;
}

interface Props {
  parts: readonly ShipMapPart[];
  /**
   * Case-insensitive part name or title to highlight (typically
   * `therm.hottestPartName`). Matched against both `name` and `title`.
   */
  highlight?: string | null;
  highlightColor?: string;
  width: number;
  height: number;
}

/** Lateral offset under which a child counts as "stack-attached" rather
 *  than side-mounted. KSP stack diameters are ~1.25m; 0.3m is well
 *  under the radius so axial-stack joints don't get misclassified. */
const STACK_LAT_TOL = 0.3;

export function ShipDiagram({
  parts,
  highlight,
  highlightColor = "var(--color-tag-yellow-fg)",
  width,
  height,
}: Readonly<Props>) {
  const [hovered, setHovered] = useState<ProjectedPart | null>(null);
  const [mouse, setMouse] = useState({ x: 0, y: 0 });
  const {
    ref: wrapperRef,
    cam,
    reset: resetView,
    panMoved,
    pointerHandlers,
  } = useZoomPan<HTMLDivElement>();

  const { projected, bounds, stages, edges } = useMemo(
    () => project(parts),
    [parts],
  );

  const padding = 24;
  const baseScale = Math.min(
    (width - padding * 2) / Math.max(bounds.w, 0.001),
    (height - padding * 2) / Math.max(bounds.h, 0.001),
  );

  const toBase = (lat: number, axial: number) => ({
    x: width / 2 + (lat - bounds.cx) * baseScale,
    y: height / 2 - (axial - bounds.cy) * baseScale,
  });

  const onWrapperMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    setMouse({ x: e.clientX - rect.left, y: e.clientY - rect.top });
  };

  if (parts.length === 0) {
    return (
      <Empty>
        No ship data yet. Save the script to <code>shipmap.ks</code> on Archive
        and press Run.
      </Empty>
    );
  }

  const transform = `translate(${cam.panX}, ${cam.panY}) scale(${cam.zoom})`;
  const stroke = (n: number) => n / cam.zoom;

  // Draw outer parts first so the central stack overlaps cleanly on top.
  const drawOrder = [...projected].sort((a, b) => b.spineDist - a.spineDist);

  return (
    <Wrapper
      ref={wrapperRef}
      onMouseMove={onWrapperMouseMove}
      {...pointerHandlers}
      $panning={panMoved.current}
    >
      <ResetButton type="button" onClick={resetView} aria-label="Reset view">
        Reset
      </ResetButton>

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
                key={`edge-${e.a.uid}-${e.b.uid}`}
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
                p.name.toLowerCase() === highlight.toLowerCase() ||
                (!!p.tag && p.tag.toLowerCase() === highlight.toLowerCase()));
            const fill = heatTint(colorFor(p.type), p.temp, p.maxTemp);
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
            return (
              <PartGroup
                key={p.uid}
                tabIndex={0}
                role="button"
                aria-label={partAriaLabel(p)}
                onPointerEnter={() => setHovered(p)}
                onPointerLeave={() =>
                  setHovered((h) => (h?.uid === p.uid ? null : h))
                }
                onFocus={() => {
                  // Position the tooltip near the focused part so keyboard
                  // users see it in a sensible place (mouse coords would
                  // be stale or zero).
                  setMouse({
                    x: center.x * cam.zoom + cam.panX,
                    y: center.y * cam.zoom + cam.panY,
                  });
                  setHovered(p);
                }}
                onBlur={() => setHovered((h) => (h?.uid === p.uid ? null : h))}
                style={{ cursor: "pointer" }}
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
                {showFuel && renderResourceFill(p.resources, box)}
                {p.tag ? (
                  <circle
                    data-role="tag-badge"
                    cx={box.x + box.w}
                    cy={box.y}
                    r={3 / cam.zoom + 1}
                    fill="var(--color-tag-cyan-fg)"
                    stroke="var(--color-surface-sunken)"
                    strokeWidth={0.6 / cam.zoom}
                    pointerEvents="none"
                  />
                ) : null}
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
              </PartGroup>
            );
          })}
        </g>
      </svg>

      {hovered && (
        <Tooltip
          style={{
            left: Math.min(mouse.x + 12, Math.max(0, width - 180)),
            top: Math.min(mouse.y + 12, Math.max(0, height - 80)),
          }}
        >
          {hovered.tag ? <div className="tag">★ {hovered.tag}</div> : null}
          <div className="title">{hovered.title || hovered.name}</div>
          <div className="row">
            <span>type</span>
            <span>{hovered.type}</span>
          </div>
          <div className="row">
            <span>mass</span>
            <span>{hovered.mass.toFixed(3)} t</span>
          </div>
          <div className="row">
            <span>pos</span>
            <span>
              {hovered.lat.toFixed(2)}, {hovered.axial.toFixed(2)}
            </span>
          </div>
          {hovered.temp !== undefined && hovered.maxTemp ? (
            <div className="row">
              <span>temp</span>
              <span>
                {Math.round(hovered.temp)} / {Math.round(hovered.maxTemp)} K
              </span>
            </div>
          ) : null}
          {hovered.stage === undefined ? null : (
            <div className="row">
              <span>stage</span>
              <span>{hovered.stage}</span>
            </div>
          )}
          {hovered.resources && hovered.resources.length > 0
            ? hovered.resources.map((r) => (
                <div className="row" key={r.n}>
                  <span>{r.n}</span>
                  <span>
                    {r.a.toFixed(0)} / {r.c.toFixed(0)}
                  </span>
                </div>
              ))
            : null}
        </Tooltip>
      )}
    </Wrapper>
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
      // Solid-fuel booster — single tall cylinder side view.
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
      // Stowed parachute: a small canister-like rectangle on the part.
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

/**
 * Tint a base colour toward red as temp/maxTemp ratio rises. Returns the
 * base colour unchanged below 50% — most parts hover around ambient and
 * we don't want every cold part to look slightly off. Above 50%, blend
 * toward amber (75%) and red (100%).
 */
/**
 * Stacks one vertical bar per drainable resource inside the part body.
 * Bars fill bottom-up (gravity-style) at `amount/capacity`. For multi-
 * resource tanks (LF + Ox) each resource gets its own column so the user
 * can see if they're draining at the same rate or one is starving.
 *
 * Returns null when there's nothing useful to draw — keeps non-fuel
 * parts visually clean.
 */
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
            {/* Empty-tank backdrop so partial fills read clearly */}
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

function partAriaLabel(p: ProjectedPart): string {
  const name = p.title || p.name;
  const bits: string[] = [];
  if (p.tag) bits.push(`tagged ${p.tag}`);
  bits.push(name, p.type, `${p.mass.toFixed(2)} tonnes`);
  if (p.resources) {
    const drainable = p.resources.filter((r) => DRAINABLE.has(r.n) && r.c > 0);
    for (const r of drainable) {
      const pct = Math.round((r.a / r.c) * 100);
      bits.push(`${r.n} ${pct} percent`);
    }
  }
  if (p.temp !== undefined && p.maxTemp && p.maxTemp > 0) {
    const ratio = p.temp / p.maxTemp;
    if (ratio > 0.75) bits.push("hot");
  }
  return bits.join(", ");
}

function heatTint(base: string, temp?: number, maxTemp?: number): string {
  if (!temp || !maxTemp || maxTemp <= 0) return base;
  const t = Math.max(0, Math.min(1, temp / maxTemp));
  if (t < 0.5) return base;
  if (t < 0.75)
    return blendHex(base, "var(--color-status-warning-bg)", (t - 0.5) / 0.25);
  return blendHex(
    "var(--color-status-warning-bg)",
    "var(--color-status-nogo-bg)",
    (t - 0.75) / 0.25,
  );
}

function blendHex(a: string, b: string, ratio: number): string {
  const pa = parseHex(a);
  const pb = parseHex(b);
  if (!pa || !pb) return a;
  const r = Math.round(pa[0] + (pb[0] - pa[0]) * ratio);
  const g = Math.round(pa[1] + (pb[1] - pa[1]) * ratio);
  const bl = Math.round(pa[2] + (pb[2] - pa[2]) * ratio);
  return `rgb(${r},${g},${bl})`;
}

function parseHex(hex: string): [number, number, number] | null {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) return null;
  const n = Number.parseInt(m[1], 16);
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

function intrinsicSize(type: PartType, mass: number): Intrinsic {
  // Mass^(1/3) is a rough proxy for linear dimension (volume → length).
  // Real values come from `p:BOUNDS` in the kerboscript — that's step 3
  // of the Ship Map plan and will make this whole table redundant.
  const m = Math.max(mass, 0.01);
  const c = Math.cbrt(m);
  switch (type) {
    case "tank":
      return { halfH: 0.45 + c * 0.4, halfW: 0.4 + c * 0.15, stretchy: true };
    case "booster":
      return { halfH: 0.6 + c * 0.5, halfW: 0.5 + c * 0.15, stretchy: true };
    case "engine":
      // Stretchy: an engine in a stack slab grows the mount block above
      // its bell to fill the gap. Bell stays width-derived in render so
      // it doesn't balloon with the body.
      return { halfH: 0.35 + c * 0.2, halfW: 0.3 + c * 0.15, stretchy: true };
    case "capsule":
      return { halfH: 0.4 + c * 0.3, halfW: 0.35 + c * 0.2, stretchy: false };
    case "decoupler":
      // Width gets overwritten with parent/child stack width during
      // projection so decouplers always span the visible stack.
      return { halfH: 0.1, halfW: 0.4, stretchy: false };
    case "rcs":
      return { halfH: 0.1, halfW: 0.08, stretchy: false };
    case "fin":
      return { halfH: 0.3, halfW: 0.35, stretchy: false };
    case "solar":
      return { halfH: 0.06, halfW: 0.18, stretchy: false };
    case "parachute":
      return { halfH: 0.25, halfW: 0.3, stretchy: false };
    default:
      return { halfH: 0.12 + c * 0.2, halfW: 0.12 + c * 0.15, stretchy: false };
  }
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

  // Pick whichever lateral axis the ship is widest on so the side-view
  // shows the actual silhouette rather than edge-on. Parts on the *other*
  // lateral axis get projected onto the spine and overlap — known
  // limitation; would need a real 3D viewer to fix.
  const xs = parts.map((p) => p.x);
  const ys = parts.map((p) => p.y);
  const spreadX = Math.max(...xs) - Math.min(...xs);
  const spreadY = Math.max(...ys) - Math.min(...ys);
  const useX = spreadX >= spreadY;

  const base: BasePart[] = parts.map((p) => ({
    ...p,
    lat: useX ? p.x : p.y,
    axial: p.z,
    type: classify(p.name, p.title, p.category),
  }));

  // Pass 1: intrinsic sizes per part.
  const intrinsics = new Map<string, Intrinsic>(
    base.map((p) => [p.uid, intrinsicSize(p.type, p.mass)]),
  );

  // Pass 2: body boxes using topology + intrinsics.
  const byUid = new Map(base.map((p) => [p.uid, p]));
  const childrenOf = new Map<string, BasePart[]>();
  for (const p of base) {
    if (!p.parent) continue;
    const list = childrenOf.get(p.parent) ?? [];
    list.push(p);
    childrenOf.set(p.parent, list);
  }

  const projected: ProjectedPart[] = base.map((p) =>
    withBody(p, byUid, childrenOf, intrinsics),
  );

  const stages = projected
    .filter((p) => p.type === "decoupler")
    .map((p) => p.axial);

  const edges: { a: ProjectedPart; b: ProjectedPart }[] = [];
  const projByUid = new Map(projected.map((p) => [p.uid, p]));
  for (const p of projected) {
    if (!p.parent) continue;
    const parent = projByUid.get(p.parent);
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
  p: BasePart,
  byUid: Map<string, BasePart>,
  childrenOf: Map<string, BasePart[]>,
  intrinsics: Map<string, Intrinsic>,
): ProjectedPart {
  const intr = intrinsics.get(p.uid);
  if (!intr) throw new Error(`ShipDiagram: missing intrinsic for ${p.uid}`);
  const parent = p.parent ? (byUid.get(p.parent) ?? null) : null;
  const children = childrenOf.get(p.uid) ?? [];

  // A child counts as "stack-attached" (axially in line with us) when its
  // lateral offset is small. Side-mounted children sit ON our flank.
  const isStackAxial = (c: BasePart) =>
    Math.abs(c.lat - p.lat) < STACK_LAT_TOL &&
    Math.abs(c.axial - p.axial) > 0.05;

  const stackParent = parent && isStackAxial(parent) ? parent : null;
  const stackChildAbove = children
    .filter((c) => isStackAxial(c) && c.axial > p.axial)
    .reduce<BasePart | null>((m, c) => (!m || c.axial > m.axial ? c : m), null);
  const stackChildBelow = children
    .filter((c) => isStackAxial(c) && c.axial < p.axial)
    .reduce<BasePart | null>((m, c) => (!m || c.axial < m.axial ? c : m), null);

  let axialMax = p.axial + intr.halfH;
  let axialMin = p.axial - intr.halfH;

  if (intr.stretchy) {
    // Tank/booster fills its slab. Meets stretchy neighbours at the
    // midpoint; meets non-stretchy neighbours (engine, decoupler) at
    // the neighbour's intrinsic boundary so we don't overlap them.
    const upper =
      stackParent && stackParent.axial > p.axial
        ? stackParent
        : stackChildAbove;
    const lower =
      stackParent && stackParent.axial < p.axial
        ? stackParent
        : stackChildBelow;
    if (upper) {
      const ui = intrinsics.get(upper.uid);
      if (ui) {
        axialMax = ui.stretchy
          ? (p.axial + upper.axial) / 2
          : upper.axial - ui.halfH;
      }
    }
    if (lower) {
      const li = intrinsics.get(lower.uid);
      if (li) {
        axialMin = li.stretchy
          ? (p.axial + lower.axial) / 2
          : lower.axial + li.halfH;
      }
    }
  }

  // Extend body to contain side-mounted children (RCS, batteries,
  // aerocams glued to our flank). Skipped for fin/solar — those stick
  // out past the body proper, and including them would balloon the
  // booster's lateral extent past where it makes sense.
  let latMin = p.lat - intr.halfW;
  let latMax = p.lat + intr.halfW;
  for (const c of children) {
    if (isStackAxial(c)) continue;
    const ci = intrinsics.get(c.uid);
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

  // Decouplers inherit width from neighbouring stack parts so the band
  // always spans the visible stack diameter.
  if (p.type === "decoupler") {
    const widthOf = (n: BasePart | null) =>
      n ? (intrinsics.get(n.uid)?.halfW ?? 0) : 0;
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

// Categories the v2 kerboscript can emit — kept here so adding a new
// category in-game just needs the matching enum addition.
const CATEGORY_TO_TYPE: Record<string, PartType> = {
  engine: "engine",
  booster: "booster",
  tank: "tank",
  decoupler: "decoupler",
  rcs: "rcs",
  capsule: "capsule",
  solar: "solar",
  parachute: "parachute",
  fin: "fin",
  other: "other",
};

function classify(name: string, title: string, category?: string): PartType {
  if (category && CATEGORY_TO_TYPE[category]) return CATEGORY_TO_TYPE[category];
  // Name/title heuristics — only used for v1 payloads (no category) or
  // unknown categories.
  const n = `${name} ${title}`.toLowerCase();
  if (n.includes("solid") && n.includes("booster")) return "booster";
  if (n.includes("engine") || n.includes("liquidengine")) return "engine";
  if (n.includes("decoupler") || n.includes("separator")) return "decoupler";
  if (n.includes("rcs") || n.includes("monoprop") || n.includes("thruster"))
    return "rcs";
  if (n.includes("winglet") || n.includes("wing") || n.includes("fin"))
    return "fin";
  if (
    n.includes("capsule") ||
    n.includes("pod") ||
    n.includes("command") ||
    n.includes("cockpit")
  )
    return "capsule";
  if (n.includes("solar") || n.includes("photovoltaic")) return "solar";
  if (n.includes("parachute")) return "parachute";
  if (
    n.includes("tank") ||
    n.includes("fuel") ||
    n.includes("fl-t") ||
    n.includes("fl-r") ||
    n.includes("rocketmax")
  )
    return "tank";
  return "other";
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

const Wrapper = styled.div<{ $panning: boolean }>`
  position: relative;
  width: 100%;
  height: 100%;
  touch-action: none;
  user-select: none;
  cursor: ${(p) => (p.$panning ? "grabbing" : "grab")};
`;

const ResetButton = styled.button`
  position: absolute;
  top: 6px;
  left: 6px;
  z-index: 10;
  font-size: var(--font-size-xs);
  padding: 2px 8px;
  background: var(--color-surface-raised);
  color: var(--color-status-go-fg);
  border: 1px solid var(--color-border-strong);
  border-radius: 2px;
  cursor: pointer;
  &:hover {
    background: var(--color-border-subtle);
  }
  &:focus-visible {
    outline: 2px solid var(--color-accent-fg);
    outline-offset: 2px;
  }
`;

const Tooltip = styled.div`
  position: absolute;
  background: var(--color-surface-sunken);
  color: var(--color-text-primary);
  font-size: 11px;
  padding: 6px 8px;
  border: 1px solid var(--color-border-strong);
  border-radius: 2px;
  pointer-events: none;
  min-width: 140px;
  z-index: 20;
  .tag {
    color: var(--color-tag-cyan-fg);
    font-weight: 600;
    margin-bottom: 2px;
    word-break: break-word;
  }
  .title {
    font-weight: 600;
    color: var(--color-status-go-fg);
    margin-bottom: 4px;
    word-break: break-word;
  }
  .row {
    display: flex;
    justify-content: space-between;
    gap: 12px;
    color: var(--color-text-muted);
    span:last-child {
      color: var(--color-text-primary);
    }
  }
`;

const Empty = styled.div`
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--color-text-dim);
  font-size: 11px;
  padding: 12px;
  text-align: center;
  width: 100%;
  height: 100%;
  code {
    background: var(--color-surface-raised);
    padding: 1px 4px;
    border-radius: 2px;
    color: var(--color-status-go-fg);
    margin: 0 2px;
  }
`;
