import { getDataSource } from "@ksp-gonogo/core";
import { useEffect, useReducer, useRef } from "react";
import type { CelestialBody } from "./useCelestialBodies";

/**
 * Subscribes to `b.o.phaseAngle[i]` for each child of the rendered frame so
 * the AlmanacPanel can show the current phase angle to the active vessel
 * and SystemDiagram can render a live numeric label next to each body.
 *
 * Subscription set is keyed by the bodies' indices, so the effect only
 * re-runs when the visible body list changes (frame switch). One sub per
 * visible body is bounded by the total body count (~17 in stock Kerbol).
 *
 * Phase angle for the active vessel's parent is meaningless — caller is
 * expected to suppress the label for that body. This hook itself doesn't
 * filter, so other uses (e.g. transfer windows from a different parent)
 * stay possible.
 */
export function usePhaseAngles(
  bodies: readonly CelestialBody[],
  sourceId = "data",
): Map<number, number> {
  const valuesRef = useRef<Map<number, number>>(new Map());
  const [, bump] = useReducer((x: number) => x + 1, 0);

  // Stable signature so we don't churn the effect on every render.
  const indices = bodies.map((b) => b.index).join(",");

  // biome-ignore lint/correctness/useExhaustiveDependencies: `indices` is the stable proxy for `bodies` — depending on `bodies` directly would re-run the effect on every render because the array identity changes
  useEffect(() => {
    const source = getDataSource(sourceId);
    if (!source) return;
    valuesRef.current = new Map();
    bump();

    const unsubs: Array<() => void> = [];
    for (const body of bodies) {
      const key = `b.o.phaseAngle[${body.index}]`;
      unsubs.push(
        source.subscribe(key, (value) => {
          if (typeof value !== "number" || !Number.isFinite(value)) return;
          valuesRef.current.set(body.index, value);
          bump();
        }),
      );
    }
    return () => {
      for (const u of unsubs) u();
    };
  }, [indices, sourceId]);

  return valuesRef.current;
}
