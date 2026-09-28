import type { OrbitTrajectory } from "@ksp-gonogo/sitrep-client";
import {
  DEPTH_ABOVE_COLOUR,
  DEPTH_BELOW_COLOUR,
  DEPTH_LEVEL_COLOUR,
  type DepthGradientAxis,
  depthColour,
  depthStrength,
} from "./depthCues";
import { liftArc, openPath, type VesselOrbit } from "./diagramGeometry";
import type { ProjectedPatch } from "./predictedTrajectory";
import type { Placement } from "./projection";

/** The active vessel's own ring, thinner than a body orbit so the two classes read apart. */
const ACTIVE_VESSEL_ORBIT_STROKE_WIDTH = 1;

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

/**
 * The vessel's trajectory, drawn as the propagation seam authorised it, through the same placement as the bodies so both share one frame.
 *
 * - CONIC: the elements are the curve, sampled in three dimensions like a body's ring
 * - PERIFOCAL: lifted from the orbit's plane to parent-centred metres by the elements' rotation
 * - BODY-CENTRED-INERTIAL: already in parent-centred metres
 *
 * Any other frame, or a refusal, draws nothing: an empty path and no trajectory look identical and mean opposite things.
 */
export function VesselOrbitPath({
  vessel,
  trajectory,
  conicRing,
  placement,
  plotScale,
  gradId,
  hasGradient,
  zoom,
}: Readonly<{
  vessel: VesselOrbit;
  trajectory: OrbitTrajectory | null;
  conicRing: string | null;
  placement: Placement;
  plotScale: number;
  gradId: string;
  hasGradient: boolean;
  zoom: number;
}>) {
  if (trajectory === null || trajectory.shape === "withheld") return null;
  // Screen-constant stroke and dashes.
  const strokeW = ACTIVE_VESSEL_ORBIT_STROKE_WIDTH / zoom;
  const dashes = `${4 / zoom} ${3 / zoom}`;
  const stroke = hasGradient ? `url(#${gradId})` : DEPTH_LEVEL_COLOUR;
  if (trajectory.shape === "conic") {
    if (conicRing === null) return null;
    return (
      <path
        data-vessel-trajectory="conic"
        d={conicRing}
        fill="none"
        stroke={stroke}
        strokeWidth={strokeW}
        strokeDasharray={dashes}
        pointerEvents="none"
      />
    );
  }
  const lifted = liftArc(trajectory, vessel);
  if (lifted === null) return null;
  return (
    <path
      data-vessel-trajectory="arc"
      data-trajectory-frame={trajectory.frame.kind}
      d={openPath(
        lifted.map((p) => placement.place(p)),
        plotScale,
      )}
      fill="none"
      stroke={stroke}
      strokeWidth={strokeW}
      strokeDasharray={dashes}
      pointerEvents="none"
    />
  );
}

// Live patch solid green; upcoming patches dashed, info-blue for an escape and warm for an encounter.
function patchStroke(patch: ProjectedPatch): string {
  if (patch.isCurrent) return "var(--color-accent-fg)";
  if (patch.startEncounter === "escape") return "var(--color-info-mark)";
  return "var(--color-warn-mark)";
}

export function PredictedPatchArc({
  patch,
  points,
  plotScale,
  zoom,
}: Readonly<{
  patch: ProjectedPatch;
  points: readonly (readonly [number, number, number])[];
  plotScale: number;
  zoom: number;
}>) {
  if (points.length < 2) return null;
  const d = openPath(points, plotScale);
  const stroke = patchStroke(patch);
  return (
    <path
      d={d}
      fill="none"
      stroke={stroke}
      // Screen-constant stroke and dashes.
      strokeWidth={(patch.isCurrent ? 1.6 : 1.2) / zoom}
      strokeDasharray={patch.isCurrent ? undefined : `${5 / zoom} ${4 / zoom}`}
      opacity={patch.isCurrent ? 0.95 : 0.7}
      pointerEvents="none"
    />
  );
}

export function EncounterMarker({
  x,
  y,
  kind,
  body,
  zoom,
}: Readonly<{
  x: number;
  y: number;
  kind: "encounter" | "escape";
  body: string;
  zoom: number;
}>) {
  const color =
    kind === "escape" ? "var(--color-info-mark)" : "var(--color-warn-mark)";
  const r = 4 / zoom;
  const label = kind === "escape" ? `escape ${body}` : `↳ ${body}`;
  return (
    <g pointerEvents="none">
      <circle
        cx={x}
        cy={y}
        r={r}
        fill="none"
        stroke={color}
        strokeWidth={1.5 / zoom}
      />
      <circle cx={x} cy={y} r={r * 0.35} fill={color} />
      <text
        x={x + r + 3 / zoom}
        y={y + 3 / zoom}
        fill={color}
        fontSize={8 / zoom}
        fontWeight={600}
      >
        {label}
      </text>
    </g>
  );
}
