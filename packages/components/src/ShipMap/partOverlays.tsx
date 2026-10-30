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
 * Indicators driven by live part state: engine flame,
 * deploy chevron, open cargo bay. Returns null before any live state, so a
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
      // "active" means ignited, not thrusting: a flamed-out engine keeps it, so the flame also needs fuel and throttle.
      return m.state === "active" && !m.flameout && throttle > 0
        ? renderEngineFlame(box, zoom)
        : null;
    case "solarPanel":
    case "radiator":
    case "antenna":
      return m.state === "deploying" || m.state === "retracting"
        ? renderAnimatingChevron(box, m.state, zoom)
        : null;
    case "cargoBay":
      if (m.state === "extended") return renderCargoBayOpenMark(box, zoom);
      return m.state === "deploying" || m.state === "retracting"
        ? renderAnimatingChevron(box, m.state, zoom)
        : null;
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

function renderCargoBayOpenMark(box: ScreenBox, zoom: number): React.ReactNode {
  // The hold seen through its open doors: a dark well with a dashed rim, the doors being the lighter strips either side.
  const { x, y, w, h } = box;
  const insetX = w * 0.2;
  const insetY = Math.min(w, h) * 0.1;
  return (
    <rect
      key="cargo-bay-open"
      data-role="cargo-bay-open"
      x={x + insetX}
      y={y + insetY}
      width={w - insetX * 2}
      height={h - insetY * 2}
      fill="var(--color-surface-raised)"
      fillOpacity={0.85}
      stroke="var(--color-go-text)"
      strokeWidth={1.5 / zoom}
      strokeDasharray={`${4 / zoom} ${3 / zoom}`}
      opacity={0.9}
      pointerEvents="none"
    />
  );
}
