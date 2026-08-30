import { useTelemetry } from "@ksp-gonogo/core";
import { useMemo } from "react";
import { bodyNamed, type StreamBodies, type StreamBody } from "./streamBody";

/**
 * The body the stream says the vessel is at, physics off the wire.
 *
 * <p>Takes the name `vessel.state` already resolved by index and matches it
 * against the same `system.bodies` roster it came from, so the pair is always
 * the running game's own naming rather than a comparison with a bundled table
 * of stock bodies. A planet pack renames both sides together, which is exactly
 * the case a `getBody(name)` lookup missed: the radius and the gravitational
 * parameter came back undefined and the reference curve that needed them
 * silently stopped being drawn.</p>
 *
 * <p>`fallbackName` is the second name to try, for the widget that prefers the
 * orbit's reference body and falls back to the vessel's parent.</p>
 *
 * <p>A widget calling this must declare `system.bodies` in its manifest;
 * without it the channel is not carried and nothing arrives.</p>
 *
 * <p>Memoised, because the merge builds a fresh object and every caller feeds
 * it to a `useMemo` that samples a curve sixty times. `getBody` returned the
 * registry's own stable entry, so an unmemoised replacement would have
 * re-sampled all three reference curves on every render without moving a
 * single point.</p>
 */
export function useStreamBody(
  name: string | null | undefined,
  fallbackName?: string | null,
): StreamBody | undefined {
  const reading = useTelemetry("system.bodies");
  /* A body roster does not decay: last frame's radius is still this frame's,
     so a dated record beats a blank plot. */
  const bodies =
    reading.state === "observed" || reading.state === "stale"
      ? (reading.value as StreamBodies | undefined)
      : undefined;
  return useMemo(
    () => bodyNamed(bodies, name) ?? bodyNamed(bodies, fallbackName),
    [bodies, name, fallbackName],
  );
}
