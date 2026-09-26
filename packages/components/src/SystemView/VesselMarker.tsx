import type { PlacedPoint } from "./diagramGeometry";
import { DepthRing } from "./diagramMarks";

/**
 * How a craft's position on the diagram is KNOWN, which is not the same as
 * where it is.
 *
 * - `observed`: contact right now, so the marker is a measurement
 * - `predicted`: out of contact, so the marker is dead reckoning, drawn hollow
 *   and desaturated, because an operator must never read a propagated position
 *   with the same confidence as a reported one
 * - `overdue`: predicted, and past the moment it should have re-appeared
 * - `lost`: given up on
 */
export type VesselPlotState = "observed" | "predicted" | "overdue" | "lost";

/** Maps a contributor's semantic severity onto this diagram's plot state; the host alone decides what a severity looks like, and `emphasis: "observed"` maps to the plain marker. */
export function vesselPlotStateFromStatus(
  status: {
    severity: "info" | "warning" | "critical";
    emphasis: "observed" | "reckoned";
  } | null,
): VesselPlotState {
  if (!status || status.emphasis === "observed") return "observed";
  switch (status.severity) {
    case "critical":
      return "lost";
    case "warning":
      return "overdue";
    default:
      return "predicted";
  }
}

/**
 * Stroke colour per plot state, exported so a test can check each token exists: an undefined `var()` paints nothing.
 * These are the on-dark variants; the `*-fg` tokens are meant for their `*-bg` fills.
 */
export const MARKER_STATE_COLOURS: Record<VesselPlotState, string> = {
  observed: "var(--color-accent-fg)",
  predicted: "var(--color-text-muted)",
  overdue: "var(--color-status-warning-fg-muted)",
  lost: "var(--color-status-nogo-bg)",
};

function markerStyle(state: VesselPlotState) {
  const colour = MARKER_STATE_COLOURS[state];
  switch (state) {
    case "overdue":
      return { colour, filled: false, opacity: 0.95 };
    case "lost":
      return { colour, filled: false, opacity: 0.85 };
    case "predicted":
      // Desaturated and hollow: a reckoned position, not a reported one.
      return { colour, filled: false, opacity: 0.7 };
    default:
      return { colour, filled: true, opacity: 1 };
  }
}

/** Screen-px distance below which a vessel marker overlaps its parent body's dot. */
export const MARKER_CROWD_THRESHOLD_PX = 18;

/** How far outside the crowd threshold an offset marker is pushed, screen px. */
const MARKER_OFFSET_MARGIN_PX = 8;

export interface VesselMarkerPlacement {
  /** Where the marker actually renders, user-space (pre-zoom) coordinates. */
  marker: { x: number; y: number };
  /**
   * The true (un-offset) position, when the marker had to move to stay
   * legible: a leader line is drawn from here to `marker`. `null` when the
   * marker renders at its true position.
   */
  leaderFrom: { x: number; y: number } | null;
}

/**
 * Where a vessel marker renders, and whether it needs a leader line back to its true position.
 *
 * A crowded marker is pushed out along its own direction from `anchor`, the DRAWN position of the body it orbits, not the origin (in a pulsating frame the origin is the pair's mass centre). A vessel exactly on the anchor falls back to up-and-right.
 */
export function resolveVesselMarkerPlacement(
  pos: { x: number; y: number },
  zoom: number,
  anchor: { x: number; y: number } = { x: 0, y: 0 },
): VesselMarkerPlacement {
  const dx = pos.x - anchor.x;
  const dy = pos.y - anchor.y;
  const screenDist = Math.hypot(dx, dy) * zoom;
  if (screenDist >= MARKER_CROWD_THRESHOLD_PX) {
    return { marker: pos, leaderFrom: null };
  }
  const angle = screenDist > 1e-6 ? Math.atan2(dy, dx) : -Math.PI / 4;
  const targetUserDist =
    (MARKER_CROWD_THRESHOLD_PX + MARKER_OFFSET_MARGIN_PX) / zoom;
  return {
    marker: {
      x: anchor.x + Math.cos(angle) * targetUserDist,
      y: anchor.y + Math.sin(angle) * targetUserDist,
    },
    leaderFrom: pos,
  };
}

export function VesselMarker({
  at,
  crowdAnchor,
  zoom,
  state = "observed",
  held = false,
}: Readonly<{
  at: PlacedPoint;
  crowdAnchor: PlacedPoint;
  zoom: number;
  state?: VesselPlotState;
  /** The read this position came off is no longer arriving; see the prop on the diagram. */
  held?: boolean;
}>) {
  const pos = { x: at.x, y: at.y };
  const { marker, leaderFrom } = resolveVesselMarkerPlacement(
    pos,
    zoom,
    crowdAnchor,
  );
  const r = 5 / zoom;
  const style = markerStyle(state);
  const { colour, opacity } = style;
  // Held draws hollow and dashed like a reckoned position: shape rather than shade, so it does not rely on colour alone (WCAG 1.4.1).
  const filled = style.filled && !held;
  return (
    <g
      pointerEvents="none"
      opacity={opacity}
      data-vessel-position={held ? "held" : "current"}
    >
      {/* A <g> takes no non-interactive role, so SVG's own title names it rather than aria-label. */}
      <title>
        {held ? "Vessel position, no longer current" : "Vessel position"}
      </title>
      <DepthRing
        cx={marker.x}
        cy={marker.y}
        radius={r * 3}
        depthPx={at.depthUnits * zoom}
        zoom={zoom}
      />
      {leaderFrom && (
        // Says "the true position is back here": drawn first so the marker itself sits on top of it.
        <line
          x1={leaderFrom.x}
          y1={leaderFrom.y}
          x2={marker.x}
          y2={marker.y}
          stroke={colour}
          strokeWidth={0.8 / zoom}
          strokeDasharray={`${1.5 / zoom} ${1.5 / zoom}`}
          opacity={0.6}
        />
      )}
      <circle
        data-vessel-marker=""
        cx={marker.x}
        cy={marker.y}
        r={r}
        fill={filled ? colour : "none"}
        stroke={filled ? "var(--color-text-inverse)" : colour}
        strokeWidth={(filled ? 1 : 1.4) / zoom}
        // Dashed ring for a reckoned position: the same visual language the upcoming-patch arcs already use for "computed, not observed".
        strokeDasharray={filled ? undefined : `${3 / zoom} ${2.5 / zoom}`}
      />
      <circle
        cx={marker.x}
        cy={marker.y}
        r={r * 2.2}
        fill="none"
        stroke={colour}
        strokeWidth={0.6 / zoom}
        opacity={0.5}
      />
    </g>
  );
}
