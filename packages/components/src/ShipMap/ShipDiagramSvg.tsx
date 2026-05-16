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
  // Fuel-line parts come out of the main pass and render as source→target
  // arrows in a separate layer on top.
  const drawOrder = [...projected]
    .filter((p) => p.type !== "fuel-line")
    .sort((a, b) => b.spineDist - a.spineDist);
  const fuelLines = projected.filter((p) => p.type === "fuel-line");
  const partsById = new Map(projected.map((p) => [p.flightId, p]));

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

          // Convert the projected rotationRad into an SVG-degrees rotate
          // applied around the part's centre. Zero rotation (the legacy
          // / fixture-fallback case) renders as today; non-zero rotation
          // turns the body box + every overlay together so fuel bars,
          // heat tint, EC + highlight rings stay locked to the part.
          const rotateDeg = (p.rotationRad * 180) / Math.PI;
          const rotateTransform =
            Math.abs(rotateDeg) > 0.01
              ? `rotate(${rotateDeg.toFixed(2)} ${center.x.toFixed(2)} ${center.y.toFixed(2)})`
              : undefined;

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
              {renderPartStateOverlays(p, box, cam.zoom)}
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
  // Render the line as a stubby yellow pipe with a row of small dark
  // chevrons inside indicating flow direction. The whole pipe lives in
  // a rotated local frame whose +X axis points from source to target,
  // so the chevrons just need to point in local +X.
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.hypot(dx, dy);
  if (len < 1) return null;
  const angleDeg = (Math.atan2(dy, dx) * 180) / Math.PI;

  const thickness = 16 / zoom;
  const stroke = 0.5 / zoom;
  // Cluster chevrons in the middle stretch so the pipe-end joints stay
  // visually clean. Each chevron is roughly half the pipe's thickness
  // (leaves margin top and bottom), and the stride is ~1.5× the chevron
  // width so the row reads as discrete arrows rather than a dashed
  // pattern.
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
 * Render visual indicators driven by `v.partState[fid]`: an engine flame
 * when the engine is firing, a parachute canopy when it's deploying or
 * extended, a deploy chevron on solar panels / radiators / antennas
 * mid-animation, a deployed-gear stand when landing gear is down.
 *
 * Returns null when the part has no live state yet — pre-push parts
 * look identical to inactive ones, which is the right default (operator
 * sees "nothing happening" rather than a misleading "deployed" state
 * stale from a previous flight).
 *
 * All overlays sit in part-local coordinates inside the parent's
 * rotation transform, so flames pointing in part-local -up correctly
 * project away from the part regardless of mount orientation.
 */
function renderPartStateOverlays(
  p: { partState?: { type: string; state: string }[]; type: PartType },
  box: ScreenBox,
  zoom: number,
): React.ReactNode {
  const states = p.partState;
  if (!states || states.length === 0) return null;
  const overlays: React.ReactNode[] = [];
  for (const m of states) {
    if (m.type === "engine" && m.state === "active") {
      overlays.push(renderEngineFlame(box, zoom));
    } else if (m.type === "parachute") {
      const canopy = renderParachuteCanopy(box, m.state, zoom);
      if (canopy) overlays.push(canopy);
    } else if (
      (m.type === "solarPanel" ||
        m.type === "radiator" ||
        m.type === "antenna") &&
      (m.state === "deploying" || m.state === "retracting")
    ) {
      overlays.push(renderAnimatingChevron(box, m.state, zoom));
    } else if (m.type === "landingGear" && m.state === "extended") {
      overlays.push(renderLandingGearStand(box, zoom));
    } else if (m.type === "cargoBay" && m.state === "extended") {
      overlays.push(renderCargoBayOpenMark(box, zoom));
    }
  }
  return overlays.length > 0 ? <>{overlays}</> : null;
}

function renderEngineFlame(box: ScreenBox, zoom: number): React.ReactNode {
  // Stylised flame below the engine bell. Outer flame in warning-amber,
  // inner core in yellow. Height ~40% of the engine body so it reads
  // clearly at full-vessel zoom without dominating the diagram.
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

function renderParachuteCanopy(
  box: ScreenBox,
  state: string,
  _zoom: number,
): React.ReactNode {
  // Canopy sits above the parachute canister body (in part-local +up).
  // Width and height grow with deploy progression so the operator sees
  // the chute open out — armed = small marker, deploying = mid canopy,
  // extended = full mushroom.
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
  // Small chevron in the part's spine-facing corner indicating the
  // deploy / retract animation is in flight. Operator sees a momentary
  // marker on a part transitioning from stowed → extended, useful for
  // catching solar panels mid-deploy after a stage event.
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
  // Short stand under the wheel/gear indicating "down". For now a tiny
  // tick below the body box — clear enough that the gear is extended
  // without redrawing the wheel itself.
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
  // Dashed inset rect to suggest the cargo-bay doors are open. Sized
  // smaller than the bay body so the original orange rect frames it.
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
      // Stack decouplers (wide w, short h) keep the thin-band rendering
      // — KSP stack decouplers really are flat discs and the geometric
      // thinness is part of their identity. Radial decouplers (tall
      // narrow box) take the full body extent: their mesh genuinely
      // does span the gap between the parent stack and the side stack,
      // and reducing them to a 12 px bar was hiding the bridge. Both
      // paths still render the full long-axis extent so the slab
      // connects its neighbours visually.
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
      // Side-profile of a rolling wheel — circle (or ellipse for slightly
      // asymmetric bounds). Radius takes the smaller half-extent so the
      // wheel never overflows a side-mounted-on-rover body box.
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
    case "capsule": {
      // Truncated cone (frustum) — Mk1 pod and probe cores both share the
      // wider-at-base silhouette. Apex flat (not pointed) and stretches
      // to the bounds top so parts attached above the pod (e.g. the
      // parachute) visually touch instead of floating with a gap.
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
      // Rounded dome whose apex reaches the bounds top. Cubic Bezier with
      // both control points pulled to y so the curve is tangent to the
      // top edge at its peak — gives a smoother nose than a Q curve.
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
    case "parachute": {
      // Stowed parachute canister — squat dome that sits on its mount.
      // Flat bottom matching the base width, semicircular top reaching
      // the bounds apex via cubic-Bezier control points pulled to y.
      // Inset narrower than the bounds box because the canister itself
      // is smaller than its mounted footprint.
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
