import type { ResolvedSystemEntity } from "./resolveSystemEntities";

const TRAVELLING_PULSE_STROKE_WIDTH_PX = 2;
/** Left padding on the exit clip so anti-aliasing at the trailing edge is not hard-cropped. */
const TRAVELLING_PULSE_CLIP_PAD_PX = 4;
/** Half-height of the exit clip; it only bounds the travel axis, so this just clears the wave's amplitude. */
const TRAVELLING_PULSE_CLIP_HALF_HEIGHT_PX = 40;
/** Fixed pixel ripple constants, so a long pulse reads as many ripples rather than a stretched one. */
const TRAVELLING_PULSE_WAVELENGTH_PX = 12;
const TRAVELLING_PULSE_AMPLITUDE_PX = 3;
const TRAVELLING_PULSE_SAMPLE_STEP_PX = 2;
/** How far past the target, as a fraction of the pulse's on-screen length, the fade band extends. */
const TRAVELLING_PULSE_FADE_FRACTION = 0.6;
/** Floor on the fade distance so a near-clamped pulse still gets a visible fade. */
const TRAVELLING_PULSE_MIN_FADE_PX = 2;

/** `points` for a sine-wave polyline `lengthPx` long; the ripple phase is painted on the segment's local x, and `offsetPx` only moves the whole segment. */
export function travellingPulseWavePoints(
  lengthPx: number,
  offsetPx = 0,
): string {
  const steps = Math.max(
    1,
    Math.round(lengthPx / TRAVELLING_PULSE_SAMPLE_STEP_PX),
  );
  const points: string[] = [];
  for (let i = 0; i <= steps; i++) {
    const localX = (i / steps) * lengthPx;
    const y =
      TRAVELLING_PULSE_AMPLITUDE_PX *
      Math.sin((localX / TRAVELLING_PULSE_WAVELENGTH_PX) * 2 * Math.PI);
    points.push(`${localX + offsetPx},${y}`);
  }
  return points.join(" ");
}

/** One pass of a pulse from its apex toward its tip, positioned on the real clock: departs so that it reaches the tip at `arriveUt` and clears by `clearUt`. */
export function TravellingPulse({
  resolved: r,
  nowUt,
}: Readonly<{
  resolved: Extract<ResolvedSystemEntity, { kind: "travelling-pulse" }>;
  nowUt: number;
}>) {
  const dx = r.x2 - r.x1;
  const dy = r.y2 - r.y1;
  const bodyPx = Math.hypot(dx, dy);
  if (!(bodyPx > 0)) return null;
  const angleDeg = (Math.atan2(dy, dx) * 180) / Math.PI;
  const segmentLengthPx = Math.min(r.segmentLengthPx, bodyPx);
  if (!(segmentLengthPx > 0)) return null;
  const crossingS = r.clearUt - r.arriveUt;
  if (!(crossingS > 0)) return null;

  // One constant rate for the whole journey, from the crossing phase, so the real-metres ratio maps straight onto the real-UT window the wave occupies.
  const ratePxPerS = segmentLengthPx / crossingS;
  const travelS = bodyPx / ratePxPerS;
  // Derived here: a contribution has no wall clock, only `arriveUt` and `clearUt`.
  const departUt = r.arriveUt - travelS;
  // The pulse keeps going one segment length past the tip before it counts as cleared.
  const exitPx = bodyPx + segmentLengthPx;
  const leadingPx = ratePxPerS * (nowUt - departUt);
  // A defensive bound; the event's own data should drop this entity by `clearUt`.
  if (!(leadingPx > 0) || leadingPx > exitPx) return null;

  const startPx = leadingPx - segmentLengthPx;
  // Past the target the wave fades rather than cutting off, since the data carries no precise overshoot; the band scales with the pulse length, floored.
  const fadeDistancePx = Math.max(
    segmentLengthPx * TRAVELLING_PULSE_FADE_FRACTION,
    TRAVELLING_PULSE_MIN_FADE_PX,
  );
  const clipId = `system-entities-pulse-clip-${r.id}`;
  const gradientId = `system-entities-pulse-fade-${r.id}`;
  return (
    <g
      transform={`translate(${r.x1} ${r.y1}) rotate(${angleDeg})`}
      pointerEvents="none"
      data-entity-id={r.id}
    >
      <defs>
        {/* Fixed in the apex-anchored frame, so the segment never renders before it departs. */}
        <clipPath id={clipId} clipPathUnits="userSpaceOnUse">
          <rect
            x={-TRAVELLING_PULSE_CLIP_PAD_PX}
            y={-TRAVELLING_PULSE_CLIP_HALF_HEIGHT_PX}
            width={exitPx + TRAVELLING_PULSE_CLIP_PAD_PX}
            height={TRAVELLING_PULSE_CLIP_HALF_HEIGHT_PX * 2}
          />
        </clipPath>
        {/* Pinned over the target, not to the wave's moving position. */}
        <linearGradient
          id={gradientId}
          gradientUnits="userSpaceOnUse"
          x1={bodyPx}
          y1={0}
          x2={bodyPx + fadeDistancePx}
          y2={0}
        >
          <stop offset={0} stopColor={r.colour} stopOpacity={r.opacity} />
          <stop offset={1} stopColor={r.colour} stopOpacity={0} />
        </linearGradient>
      </defs>
      <g clipPath={`url(#${clipId})`}>
        {/* Points are computed at the wave's current position each render. */}
        <polyline
          points={travellingPulseWavePoints(segmentLengthPx, startPx)}
          fill="none"
          stroke={`url(#${gradientId})`}
          strokeWidth={TRAVELLING_PULSE_STROKE_WIDTH_PX}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </g>
    </g>
  );
}
