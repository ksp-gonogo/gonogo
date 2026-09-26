import type { CelestialBody } from "@ksp-gonogo/sitrep-client";
import { useMemo } from "react";
import { buildTransferPorkchop, porkchopAxes } from "./transferData";
import { useBodyStatePropagators } from "./useBodyStatePropagators";

export type PorkchopGridOrNull = ReturnType<typeof buildTransferPorkchop>;

/**
 * One porkchop grid centred on `centerDepUt`. Its axes come first so body
 * states can be asked of the game; the grid uses the client's own conic until
 * they arrive. `null` without both bodies, or while `enabled` is false.
 */
export function usePorkchop({
  origin,
  dest,
  bodies,
  nowUt,
  centerDepUt,
  enabled = true,
}: {
  origin: CelestialBody | null | undefined;
  dest: CelestialBody | null | undefined;
  bodies: CelestialBody[];
  nowUt: number;
  centerDepUt: number | undefined;
  enabled?: boolean;
}): PorkchopGridOrNull {
  const axes = useMemo(
    () =>
      enabled && origin && dest
        ? porkchopAxes({ origin, dest, bodies, nowUt, centerDepUt })
        : null,
    [enabled, origin, dest, bodies, nowUt, centerDepUt],
  );
  const states = useBodyStatePropagators(
    origin ?? null,
    dest ?? null,
    bodies,
    axes,
  );
  return useMemo(
    () =>
      enabled && origin && dest
        ? buildTransferPorkchop({
            origin,
            dest,
            bodies,
            nowUt,
            centerDepUt,
            propagateOrigin: states?.propagateOrigin,
            propagateDest: states?.propagateDest,
          })
        : null,
    [enabled, origin, dest, bodies, nowUt, centerDepUt, states],
  );
}
