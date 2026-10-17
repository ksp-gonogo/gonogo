import { getBody } from "@ksp-gonogo/core";
import type { OrbitTrajectory, PatchChainArc } from "@ksp-gonogo/sitrep-client";
import { useId, useMemo } from "react";
import { activateOnKey } from "./activateOnKey";
import {
  DEPTH_ABOVE_COLOUR,
  DEPTH_BELOW_COLOUR,
  DEPTH_LEVEL_COLOUR,
  type DepthGradientAxis,
  depthColour,
  depthStrength,
} from "./depthCues";
import { arcMetres, openPath, type PlacedRingEnd } from "./diagramGeometry";
import type { CaptionPlace, CaptionRequest } from "./encounterCaption";
import type { Placement } from "./projection";
import { InteractiveMarker } from "./SystemEntitiesLayer";

/** The active vessel's own ring, thinner than a body orbit so the two classes read apart. */
const ACTIVE_VESSEL_ORBIT_STROKE_WIDTH = 1;

/** The target's curve, the colour its dot wears on the diagram. */
const TARGET_ORBIT_COLOUR = "var(--color-nogo-mark)";

/** A stroke gradient for how far a drawn curve leaves the reference plane, scaled by its on-screen depth span: a depth reading, not an inclination one. */
export function DepthGradient({
  id,
  axis,
  zoom,
}: Readonly<{ id: string; axis: DepthGradientAxis; zoom: number }>) {
  const stopOpacity = 0.35 + 0.55 * depthStrength(axis.depthUnits * zoom);
  return (
    <linearGradient
      id={id}
      gradientUnits="userSpaceOnUse"
      x1={axis.x1}
      y1={axis.y1}
      x2={axis.x2}
      y2={axis.y2}
    >
      <stop
        offset="0%"
        stopColor={DEPTH_BELOW_COLOUR}
        stopOpacity={stopOpacity}
      />
      <stop offset="50%" stopColor={DEPTH_LEVEL_COLOUR} stopOpacity={0.45} />
      <stop
        offset="100%"
        stopColor={DEPTH_ABOVE_COLOUR}
        stopOpacity={stopOpacity}
      />
    </linearGradient>
  );
}

/** A body's own current depth as a ring around its dot, invisible at zero depth. */
export function DepthRing({
  cx,
  cy,
  radius,
  depthPx,
  zoom,
}: Readonly<{
  cx: number;
  cy: number;
  radius: number;
  depthPx: number;
  zoom: number;
}>) {
  const strength = depthStrength(depthPx);
  if (strength <= 0) return null;
  return (
    <circle
      cx={cx}
      cy={cy}
      r={radius}
      fill="none"
      stroke={depthColour(depthPx)}
      strokeWidth={1.4 / zoom}
      opacity={0.25 + 0.6 * strength}
      pointerEvents="none"
    />
  );
}

/** How far a route drawn from a report older than the craft's place is dimmed. */
const HELD_ROUTE_OPACITY = 0.4;

/**
 * The vessel's trajectory, drawn as the propagation seam authorised it, through the same placement as the bodies so both share one frame.
 *
 * - Conic: the elements are the curve, sampled in three dimensions like a body's ring
 * - Arc: already in parent-centred inertial metres
 *
 * Any other frame, or a refusal, draws nothing: an empty path and no trajectory look identical and mean opposite things.
 */
export function VesselOrbitPath({
  trajectory,
  conicRing,
  placement,
  plotScale,
  gradId,
  hasGradient,
  zoom,
  origin = [0, 0, 0],
  subject = "vessel",
  held = false,
  heldReason,
  liveReason,
}: Readonly<{
  /** The tooltip of a target curve drawn live beside a held route, saying it is newer than the craft's report. */
  liveReason?: string;
  /** Whose curve this is; the target's is drawn in its own colour and keyed apart. */
  subject?: "vessel" | "target";
  /** Drawn from a report older than what the diagram places the craft by, so it is dimmed and marked held. */
  held?: boolean;
  /** The tooltip a held route carries, naming why it is held and how old the report is. */
  heldReason?: string;
  trajectory: OrbitTrajectory | null;
  conicRing: string | null;
  placement: Placement;
  plotScale: number;
  gradId: string;
  hasGradient: boolean;
  zoom: number;
  /** Where the body the arc is about sits against the frame body, metres. */
  origin?: readonly [number, number, number];
}>) {
  // The placed arc is held on the answer's identity, so a render carrying the same held trajectory re-places nothing.
  const arcPath = useMemo(() => {
    if (trajectory === null || trajectory.shape !== "arc") return null;
    const metres = arcMetres(trajectory);
    if (metres === null) return null;
    return openPath(
      metres.map((p) =>
        placement.place([p[0] + origin[0], p[1] + origin[1], p[2] + origin[2]]),
      ),
      plotScale,
    );
  }, [trajectory, placement, plotScale, origin]);
  if (trajectory === null || trajectory.shape === "withheld") return null;
  // Screen-constant stroke and dashes.
  const strokeW = ACTIVE_VESSEL_ORBIT_STROKE_WIDTH / zoom;
  const dashes = `${4 / zoom} ${3 / zoom}`;
  const stroke =
    subject === "target"
      ? TARGET_ORBIT_COLOUR
      : hasGradient
        ? `url(#${gradId})`
        : DEPTH_LEVEL_COLOUR;
  const tooltip = held ? heldReason : liveReason;
  const trajectoryAttr = {
    [`data-${subject}-trajectory`]: trajectory.shape,
    ...(held ? { "data-route-held": "", opacity: HELD_ROUTE_OPACITY } : {}),
  };
  if (trajectory.shape === "conic") {
    if (conicRing === null) return null;
    return (
      <>
        <path
          {...trajectoryAttr}
          d={conicRing}
          fill="none"
          stroke={stroke}
          strokeWidth={strokeW}
          strokeDasharray={dashes}
          pointerEvents="none"
        />
        {tooltip !== undefined && (
          <HeldHitPath d={conicRing} zoom={zoom} reason={tooltip} />
        )}
      </>
    );
  }
  if (arcPath === null) return null;
  return (
    <>
      <path
        {...trajectoryAttr}
        data-trajectory-frame={trajectory.frame.kind}
        d={arcPath}
        fill="none"
        stroke={stroke}
        strokeWidth={strokeW}
        strokeDasharray={dashes}
        pointerEvents="none"
      />
      {tooltip !== undefined && (
        <HeldHitPath d={arcPath} zoom={zoom} reason={tooltip} />
      )}
    </>
  );
}

/** A stop bar across the far end of a body's open arc, perpendicular to the way it was heading: nothing is drawn past it because nothing vouches for it. */
export function ArcFarEndMark({
  end,
  zoom,
  bodyName,
}: Readonly<{ end: PlacedRingEnd; zoom: number; bodyName: string }>) {
  const half = 4 / zoom;
  const nx = -end.headingY * half;
  const ny = end.headingX * half;
  return (
    <line
      data-trajectory-mark="horizon"
      data-body-orbit-end={bodyName}
      x1={end.x - nx}
      y1={end.y - ny}
      x2={end.x + nx}
      y2={end.y + ny}
      stroke="var(--color-warn-mark)"
      strokeWidth={1.6 / zoom}
      strokeLinecap="butt"
      pointerEvents="none"
    >
      <title>
        {`${bodyName}: the path is drawn to the last instant its provider vouches for`}
      </title>
    </line>
  );
}

/**
 * A transparent, wider copy of a held route that carries its tooltip.
 * It handles no pointer event itself, so a press or wheel on it reaches the diagram's pan and zoom as on empty space.
 */
function HeldHitPath({
  d,
  zoom,
  reason,
}: Readonly<{ d: string; zoom: number; reason: string }>) {
  return (
    <path
      data-route-held-hit=""
      d={d}
      fill="none"
      stroke="transparent"
      strokeWidth={10 / zoom}
      pointerEvents="stroke"
    >
      <title>{reason}</title>
    </path>
  );
}

// Live patch solid green; upcoming patches dashed, info-blue for an escape and warm for an encounter.
function patchStroke(patch: PatchChainArc): string {
  if (patch.isCurrent) return "var(--color-accent-fg)";
  if (patch.startCrossing === "escape") return "var(--color-info-mark)";
  return "var(--color-warn-mark)";
}

export function PredictedPatchArc({
  patch,
  points,
  plotScale,
  zoom,
  held = false,
  heldReason,
}: Readonly<{
  heldReason?: string;
  patch: PatchChainArc;
  points: readonly (readonly [number, number, number])[];
  plotScale: number;
  zoom: number;
  /** The chain comes from a report older than what the diagram places the craft by, so it is dimmed, dashed and marked held. */
  held?: boolean;
}>) {
  if (points.length < 2) return null;
  const d = openPath(points, plotScale);
  const stroke = patchStroke(patch);
  return (
    <>
      <path
        data-patch-body={patch.referenceBody}
        d={d}
        fill="none"
        stroke={stroke}
        // Screen-constant stroke and dashes.
        strokeWidth={(patch.isCurrent ? 1.6 : 1.2) / zoom}
        strokeDasharray={
          patch.isCurrent && !held ? undefined : `${5 / zoom} ${4 / zoom}`
        }
        opacity={held ? HELD_ROUTE_OPACITY : patch.isCurrent ? 0.95 : 0.7}
        data-route-held={held ? "" : undefined}
        pointerEvents="none"
      />
      {held && heldReason !== undefined && (
        <HeldHitPath d={d} zoom={zoom} reason={heldReason} />
      )}
    </>
  );
}

/** The caption's type size and the width of one of its characters on screen, in pixels. */
const CAPTION_FONT_PX = 8;
const CAPTION_CHAR_PX = 5;

/**
 * The words an encounter or escape marker prints beside its ring. The craft's
 * own encounter is the short form: it is drawn where the diagram is busiest.
 */
export function encounterLabel(
  kind: "encounter" | "escape",
  body: string,
  subject: "vessel" | "target" = "vessel",
): string {
  if (kind === "escape") return `escape ${body}`;
  return subject === "target" ? `encounter ${body}` : `→ ${body}`;
}

/** The size and position `placeEncounterCaptions` needs for the marker at `x`,`y` printing `label`. */
export function encounterCaptionRequest(
  x: number,
  y: number,
  label: string,
): CaptionRequest {
  return {
    x,
    y,
    widthPx: label.length * CAPTION_CHAR_PX,
    heightPx: CAPTION_FONT_PX,
  };
}

export function EncounterMarker({
  x,
  y,
  kind,
  body,
  zoom,
  subject = "vessel",
  heldReason,
  place,
}: Readonly<{
  x: number;
  y: number;
  kind: "encounter" | "escape";
  body: string;
  zoom: number;
  subject?: "vessel" | "target";
  /** Set when the marker comes from a report older than the craft's place: it is dimmed, dashed and carries this tooltip. */
  heldReason?: string;
  /** Where the caption sits beside the ring, from `placeEncounterCaptions`. */
  place: CaptionPlace;
}>) {
  const held = heldReason !== undefined;
  const color =
    kind === "escape" ? "var(--color-info-mark)" : "var(--color-warn-mark)";
  const r = 4 / zoom;
  const label = encounterLabel(kind, body, subject);
  return (
    <g
      pointerEvents={held ? "visiblePainted" : "none"}
      data-encounter-subject={subject}
      data-route-held={held ? "" : undefined}
      opacity={held ? HELD_ROUTE_OPACITY : undefined}
    >
      {held && <title>{heldReason}</title>}
      <circle
        cx={x}
        cy={y}
        r={r}
        fill="none"
        stroke={color}
        strokeWidth={1.5 / zoom}
        strokeDasharray={held ? `${2 / zoom} ${2 / zoom}` : undefined}
      />
      <circle cx={x} cy={y} r={r * 0.35} fill={color} />
      <text
        x={x + place.dx}
        y={y + place.dy}
        textAnchor={place.anchor}
        fill={color}
        fontSize={CAPTION_FONT_PX / zoom}
        fontWeight={600}
      >
        {label}
      </text>
    </g>
  );
}

/**
 * Where the target was along its orbit at the instant of the craft's report, drawn in the held route's dimmed, dashed form.
 * Used beside a held route, so the operator can compare where the plan aimed with where the target was then.
 */
export function TargetThenMark({
  x,
  y,
  zoom,
  name,
  reason,
}: Readonly<{
  x: number;
  y: number;
  zoom: number;
  name: string;
  /** The held route's own tooltip, naming the age of the report; absent when no age is known. */
  reason?: string;
}>) {
  const r = 4 / zoom;
  return (
    <g
      pointerEvents="visiblePainted"
      data-target-then=""
      data-route-held=""
      opacity={HELD_ROUTE_OPACITY}
    >
      <title>
        {reason === undefined
          ? `${name} at the craft's report`
          : `${name} at the craft's report. ${reason}`}
      </title>
      <circle
        cx={x}
        cy={y}
        r={r}
        fill="none"
        stroke={TARGET_ORBIT_COLOUR}
        strokeWidth={1.5 / zoom}
        strokeDasharray={`${2 / zoom} ${2 / zoom}`}
      />
    </g>
  );
}

/** Room kept between the picture's edge and a pointer to a body off it, screen pixels. */
export const EDGE_POINTER_INSET = 16;

/** Whether a body at `at` is drawn as a dot, and not pointed to from the picture's edge, for a view centred at `view` with these half-extents. */
export function onThePicture(
  at: { x: number; y: number },
  view: { x: number; y: number; halfW: number; halfH: number },
  zoom: number,
): boolean {
  const inset = EDGE_POINTER_INSET / zoom;
  return (
    Math.abs(at.x - view.x) <= view.halfW - inset &&
    Math.abs(at.y - view.y) <= view.halfH - inset
  );
}

/**
 * The body the frame body orbits: a dot and its name at its place while that is on the picture, and from the edge of the picture a pointer toward it when it is not.
 * The diagram draws a frame body and what orbits it, so without this a frame centred on a moon shows nothing of its planet.
 */
export function FrameParentMark({
  name,
  frameBodyName,
  at,
  view,
  zoom,
  pinned,
  onActivate,
}: Readonly<{
  name: string;
  frameBodyName: string;
  /** The body's almanac is pinned in the aside, so a further press anchors the view on it. */
  pinned: boolean;
  onActivate: () => void;
  /** Where the body is, in plot units. */
  at: { x: number; y: number };
  /** The picture's centre and half-extents, in plot units. */
  view: { x: number; y: number; halfW: number; halfH: number };
  zoom: number;
}>) {
  const hintId = useId();
  const colour = getBody(name)?.color ?? "var(--color-text-muted)";
  const inset = EDGE_POINTER_INSET / zoom;
  const dx = at.x - view.x;
  const dy = at.y - view.y;
  const reachX = view.halfW - inset;
  const reachY = view.halfH - inset;
  const title = `${name}, which ${frameBodyName} orbits`;
  const press = {
    role: "button",
    tabIndex: 0,
    "aria-label": name,
    "aria-pressed": pinned,
    "aria-describedby": pinned ? hintId : undefined,
    style: { cursor: "pointer" },
    // A press on a body selects it and never starts a pan.
    onPointerDown: (e: { stopPropagation: () => void }) => e.stopPropagation(),
    onClick: onActivate,
    onKeyDown: activateOnKey(onActivate),
  } as const;
  const hint = pinned ? (
    <desc id={hintId}>Press again to anchor the view on {name}</desc>
  ) : null;
  if (onThePicture(at, view, zoom)) {
    return (
      <InteractiveMarker data-frame-parent={name} {...press}>
        <title>{title}</title>
        {hint}
        <circle
          className="focus-ring"
          cx={at.x}
          cy={at.y}
          r={9 / zoom}
          fill="none"
          stroke="var(--color-focus)"
          strokeWidth={2 / zoom}
          pointerEvents="none"
        />
        {/* A wider transparent disc enlarges the press target without changing the drawn dot. */}
        <circle cx={at.x} cy={at.y} r={10 / zoom} fill="transparent" />
        <circle
          cx={at.x}
          cy={at.y}
          r={4 / zoom}
          fill={colour}
          stroke="var(--color-text-inverse)"
          strokeWidth={1 / zoom}
        />
        <text
          x={at.x}
          y={at.y + 15 / zoom}
          fill="var(--color-text-muted)"
          fontSize={9 / zoom}
          textAnchor="middle"
          pointerEvents="none"
        >
          {name}
        </text>
      </InteractiveMarker>
    );
  }
  // Where the line from the picture's centre to the body leaves the inset box.
  const scale = Math.min(
    dx === 0 ? Number.POSITIVE_INFINITY : reachX / Math.abs(dx),
    dy === 0 ? Number.POSITIVE_INFINITY : reachY / Math.abs(dy),
  );
  const x = view.x + dx * scale;
  const y = view.y + dy * scale;
  const bearing = (Math.atan2(dy, dx) * 180) / Math.PI;
  const tip = 6 / zoom;
  // The name sits inward of the arrowhead, on whichever side has room.
  const labelX = x - Math.sign(dx || 1) * (tip + 4 / zoom);
  const labelY = y - Math.sign(dy) * (tip + 8 / zoom) + 3 / zoom;
  return (
    <InteractiveMarker data-frame-parent-direction={name} {...press}>
      <title>{title}</title>
      {hint}
      <circle
        className="focus-ring"
        cx={x}
        cy={y}
        r={tip * 1.8}
        fill="none"
        stroke="var(--color-focus)"
        strokeWidth={2 / zoom}
        pointerEvents="none"
      />
      <path
        d={`M${tip},0 L${-tip},${tip * 0.7} L${-tip},${-tip * 0.7} Z`}
        transform={`translate(${x} ${y}) rotate(${bearing})`}
        fill={colour}
        stroke="var(--color-text-inverse)"
        strokeWidth={0.75 / zoom}
      />
      <text
        x={labelX}
        y={labelY}
        fill="var(--color-text-muted)"
        fontSize={9 / zoom}
        textAnchor={dx >= 0 ? "end" : "start"}
        pointerEvents="none"
      >
        {name}
      </text>
    </InteractiveMarker>
  );
}
