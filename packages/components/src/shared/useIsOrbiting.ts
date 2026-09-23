import { useOrbitSolve } from "@ksp-gonogo/core";
import { useStream, type VesselState } from "@ksp-gonogo/sitrep-client";
import { useMemo } from "react";
import { useStreamBody } from "./useStreamBody";

type OrbitInfo = {
  isOrbiting: boolean;
  periapsis: number | undefined;
  apoapsis: number | undefined;
  threshold: number;
};

export function useIsOrbiting(): OrbitInfo {
  // The two apsis altitudes are solved from `vessel.orbit`'s own elements, so
  // they are absent together whenever the conic behind them has withdrawn:
  // under physics, past an SOI transition, below the atmosphere interface.
  // "Not orbiting" is the right answer in all three, and it is what the guard
  // below already returns for an absent apsis. `apoapsisAlt` is also absent on
  // a hyperbolic/escape orbit, which has no apoapsis, and that case reaches the
  // same guard.
  //
  // `parentBodyName` is an index → `system.bodies` name resolution and needs no
  // conic, so it keeps its own read.
  const solve = useOrbitSolve();
  const bodyName =
    useStream<VesselState>("vessel.state")?.parentBodyName ?? undefined;
  const PeA = solve?.periapsisAlt ?? undefined;
  const ApA = solve?.apoapsisAlt ?? undefined;

  /*
   * The atmosphere height comes off `system.bodies`, so a caller must carry
   * that channel. It used to be a `getBody(name)` lookup in the table of STOCK
   * bodies: under a planet pack that missed, the threshold fell to zero, and
   * the question silently became "is the periapsis above sea level", which a
   * craft on its way down answers yes to.
   */
  const body = useStreamBody(bodyName);

  return useMemo(() => {
    if (PeA === undefined || ApA === undefined) {
      return { isOrbiting: false, periapsis: PeA, apoapsis: ApA, threshold: 0 };
    }

    const hasAtmosphere = body?.hasAtmosphere ?? false;
    const maxAtmosphere = body?.maxAtmosphere ?? 0;
    const threshold = hasAtmosphere ? maxAtmosphere : 0;

    const isOrbiting = PeA > threshold && PeA > 0 && ApA > 0;

    return { isOrbiting, periapsis: PeA, apoapsis: ApA, threshold };
  }, [PeA, ApA, body]);
}
