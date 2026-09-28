import type { PartStateModule } from "@ksp-gonogo/core";
import type React from "react";

export interface ScreenBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The share of an engine's body height its flame draws below it. */
export const ENGINE_FLAME_BODY_FRACTION = 0.4;

/**
 * A parachute canopy per deploy state, as multiples of the part's width: it
 * grows from armed through deploying to extended. States with no entry draw no
 * canopy.
 */
export const CANOPY_SHAPES: ReadonlyMap<
  string,
  { width: number; height: number; opacity: number }
> = new Map([
  ["armed", { width: 0.6, height: 0.08, opacity: 0.5 }],
  ["deploying", { width: 1.5, height: 0.45, opacity: 0.85 }],
  ["extended", { width: 2.4, height: 0.8, opacity: 0.95 }],
]);

/**
 * Indicators driven by live part state: engine flame, parachute canopy,
 * deploy chevron, gear stand. Returns null before any live state, so a
 * pre-push part looks inactive rather than stale-deployed. Drawn in
 * part-local coordinates inside the part's rotation transform.
 */
export function renderPartStateOverlays(
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
  // Outer amber, inner core yellow.
  const { x, y, w, h } = box;
  const flameH = Math.max(h * ENGINE_FLAME_BODY_FRACTION, 8 / zoom);
  const top = y + h;
  const inset = w * 0.22;
  const outer = `${x + inset},${top} ${x + w - inset},${top} ${x + w * 0.62},${top + flameH * 0.7} ${x + w * 0.5},${top + flameH} ${x + w * 0.38},${top + flameH * 0.7}`;
  const inner = `${x + inset * 1.4},${top + flameH * 0.18} ${x + w - inset * 1.4},${top + flameH * 0.18} ${x + w * 0.5},${top + flameH * 0.85}`;
  return (
    <g key="engine-flame" data-role="engine-flame" pointerEvents="none">
      <polygon points={outer} fill="var(--color-warn-mark)" opacity={0.85} />
      <polygon
        points={inner}
        fill="var(--color-tag-yellow-fg)"
        opacity={0.95}
      />
    </g>
  );
}

function renderParachuteCanopy(box: ScreenBox, state: string): React.ReactNode {
  const canopy = CANOPY_SHAPES.get(state);
  if (!canopy) return null;
  const { x, y, w } = box;
  const cx = x + w / 2;
  const canopyW = w * canopy.width;
  const canopyH = w * canopy.height;
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
        fill="var(--color-nogo-mark)"
        opacity={canopy.opacity}
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
      stroke="var(--color-go-text)"
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
      stroke="var(--color-go-text)"
      strokeWidth={1.5 / zoom}
      strokeDasharray={`${4 / zoom} ${3 / zoom}`}
      opacity={0.8}
      pointerEvents="none"
    />
  );
}
