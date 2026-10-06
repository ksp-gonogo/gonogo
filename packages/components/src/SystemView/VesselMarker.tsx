import type { AlertTone } from "@ksp-gonogo/sitrep-sdk";
import { VesselMarkSvg } from "@ksp-gonogo/ui-kit";
import { activateOnKey } from "./activateOnKey";
import type { PlacedPoint } from "./diagramGeometry";
import { DepthRing } from "./diagramMarks";
import { InteractiveMarker } from "./SystemEntitiesLayer";

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

/** Maps a contributor's tone onto this diagram's plot state; the host alone decides what a tone looks like, and `emphasis: "observed"` maps to the plain marker. */
export function vesselPlotStateFromStatus(
  status: {
    tone: AlertTone;
    emphasis: "observed" | "reckoned";
  } | null,
): VesselPlotState {
  if (!status || status.emphasis === "observed") return "observed";
  switch (status.tone) {
    case "nogo":
      return "lost";
    case "warn":
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
  overdue: "var(--color-warn-text)",
  lost: "var(--color-nogo-mark)",
};

function markerStyle(state: VesselPlotState) {
  const colour = MARKER_STATE_COLOURS[state];
  switch (state) {
    case "overdue":
      return { colour, opacity: 0.95 };
    case "lost":
      return { colour, opacity: 0.85 };
    case "predicted":
      // Faded: a reckoned position, not a reported one.
      return { colour, opacity: 0.7 };
    default:
      return { colour, opacity: 1 };
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
  selected = false,
  onActivate,
}: Readonly<{
  at: PlacedPoint;
  crowdAnchor: PlacedPoint;
  zoom: number;
  state?: VesselPlotState;
  /** The read this position came off is no longer arriving; see the prop on the diagram. */
  held?: boolean;
  /** The active vessel's own info is showing in the aside. */
  selected?: boolean;
  /** Absent leaves the marker inert, as it is where no aside has anything to say about the craft. */
  onActivate?: () => void;
}>) {
  const pos = { x: at.x, y: at.y };
  const { marker, leaderFrom } = resolveVesselMarkerPlacement(
    pos,
    zoom,
    crowdAnchor,
  );
  const r = 5 / zoom;
  const { colour, opacity } = markerStyle(state);
  // The kit's vessel mark in every state. An overdue craft is held, so it takes the square; a lost one takes the square emptied.
  const vesselMark =
    state === "lost"
      ? "lost"
      : held || state === "overdue"
        ? "held"
        : state === "predicted"
          ? "modelled"
          : "current";
  return (
    <g
      pointerEvents="none"
      opacity={opacity}
      data-vessel-position={held ? "held" : "current"}
    >
      {/* A <g> takes no non-interactive role, so SVG's own title names it rather than aria-label. */}
      <title>{held ? "Vessel position, held" : "Vessel position"}</title>
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
      <g data-vessel-marker="">
        <VesselMarkSvg state={vesselMark} x={marker.x} y={marker.y} r={r} />
      </g>
      <circle
        cx={marker.x}
        cy={marker.y}
        r={r * 2.2}
        fill="none"
        stroke={colour}
        strokeWidth={0.6 / zoom}
        opacity={0.5}
      />
      {selected && (
        <circle
          data-vessel-selected=""
          cx={marker.x}
          cy={marker.y}
          r={r * 2.8}
          fill="none"
          stroke="var(--color-focus)"
          strokeWidth={2 / zoom}
        />
      )}
      {onActivate && (
        <InteractiveMarker
          data-vessel-hit=""
          role="button"
          tabIndex={0}
          aria-label="Active vessel"
          aria-pressed={selected}
          style={{ cursor: "pointer", pointerEvents: "all" }}
          // A press on the craft selects it and never starts a pan.
          onPointerDown={(e) => e.stopPropagation()}
          onClick={onActivate}
          onKeyDown={activateOnKey(onActivate)}
        >
          <circle
            className="focus-ring"
            cx={marker.x}
            cy={marker.y}
            r={r * 3.2}
            fill="none"
            stroke="var(--color-focus)"
            strokeWidth={2 / zoom}
            pointerEvents="none"
          />
          <circle
            cx={marker.x}
            cy={marker.y}
            r={Math.max(r * 2.6, 12 / zoom)}
            fill="transparent"
          />
        </InteractiveMarker>
      )}
    </g>
  );
}
