import { useMemo } from "react";
import type { ResolvedSystemEntity } from "./resolveSystemEntities";

/** A traffic highlight riding an already-drawn `connection-line` entity, keyed by its id: a sweeping glow, so it cannot be mistaken for a vessel dot. */
export interface SystemEntityPulse {
  /** The `system.uplink.pending` entry's id, used as the React key since two pulses can share an `edgeId`. */
  id: string;
  /** The `connection-line` entity id this pulse currently sits on. */
  edgeId: string;
  /** 0..1 along the edge's own a -> b direction (its x1,y1 -> x2,y2 draw order). */
  t: number;
  opacity: number;
}

/** Half-width, in `t` units along the edge, of the pulse's bright band. */
const PULSE_BAND_T = 0.14;
/** The faint grey the CommNet lines draw in, so the sweep reads as a highlight moving along the line. */
const PULSE_BASE_COLOUR = "var(--color-text-faint)";
/** Brighter than the base but not the accent green, which this layer reserves for selection. */
const PULSE_PEAK_COLOUR = "var(--color-text-primary)";
/** Thin enough that the sweep cannot be mistaken for a vessel point or an orbit ring. */
const PULSE_STROKE_WIDTH_PX = 1.2;

function pulsesOnEdges(
  pulses: readonly SystemEntityPulse[] | undefined,
  resolved: readonly ResolvedSystemEntity[],
) {
  if (!pulses || pulses.length === 0) return [];
  const edgesById = new Map(
    resolved
      .filter((r) => r.kind === "connection-line")
      .map((r) => [r.id, r] as const),
  );
  return pulses.flatMap((p) => {
    const edge = edgesById.get(p.edgeId);
    if (!edge || edge.kind !== "connection-line") return [];
    const t = Math.min(Math.max(p.t, 0), 1);
    return [
      {
        id: p.id,
        edgeId: p.edgeId,
        opacity: p.opacity,
        x1: edge.x1,
        y1: edge.y1,
        x2: edge.x2,
        y2: edge.y2,
        t,
        bandStart: Math.max(0, t - PULSE_BAND_T),
        bandEnd: Math.min(1, t + PULSE_BAND_T),
      },
    ];
  });
}

/** Whether any pulse rides a drawn connection line. */
export function hasSweep(
  pulses: readonly SystemEntityPulse[] | undefined,
  resolved: readonly ResolvedSystemEntity[],
): boolean {
  return pulsesOnEdges(pulses, resolved).length > 0;
}

/** One travelling glow per in-flight command along the connection line it currently sits on; a pulse on no drawn line is skipped. */
export function PulseSweeps({
  pulses,
  resolved,
}: Readonly<{
  pulses: readonly SystemEntityPulse[] | undefined;
  resolved: readonly ResolvedSystemEntity[];
}>) {
  const resolvedPulses = useMemo(
    () => pulsesOnEdges(pulses, resolved),
    [pulses, resolved],
  );
  if (resolvedPulses.length === 0) return null;
  return (
    <>
      {resolvedPulses.length > 0 && (
        <defs>
          {resolvedPulses.map((p) => (
            <linearGradient
              key={p.id}
              id={`system-entities-pulse-${p.id}`}
              gradientUnits="userSpaceOnUse"
              x1={p.x1}
              y1={p.y1}
              x2={p.x2}
              y2={p.y2}
            >
              <stop
                offset={p.bandStart}
                stopColor={PULSE_BASE_COLOUR}
                stopOpacity={0}
              />
              <stop
                offset={p.t}
                stopColor={PULSE_PEAK_COLOUR}
                stopOpacity={p.opacity}
              />
              <stop
                offset={p.bandEnd}
                stopColor={PULSE_BASE_COLOUR}
                stopOpacity={0}
              />
            </linearGradient>
          ))}
        </defs>
      )}
      {resolvedPulses.map((p) => (
        <line
          key={p.id}
          data-pulse-edge-id={p.edgeId}
          x1={p.x1}
          y1={p.y1}
          x2={p.x2}
          y2={p.y2}
          stroke={`url(#system-entities-pulse-${p.id})`}
          strokeWidth={PULSE_STROKE_WIDTH_PX}
          strokeLinecap="round"
          pointerEvents="none"
        />
      ))}
    </>
  );
}
