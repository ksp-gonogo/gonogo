import { useOrbitSolve } from "@ksp-gonogo/core";
import type { OrbitalSolve } from "@ksp-gonogo/sitrep-client";
import { useMemo } from "react";
import { useBodyName, useParentBodyIndex } from "./useBodyName";
import { useStreamBody } from "./useStreamBody";

type OrbitInfo = {
  isOrbiting: boolean;
  periapsis: number | undefined;
  apoapsis: number | undefined;
  threshold: number;
};

/**
 * Whether the craft's orbit clears the atmosphere, off its current solve, or
 * off `apsides` where the caller draws an orbit the solve does not answer for.
 */
export function useIsOrbiting(
  apsides?: Pick<OrbitalSolve, "periapsisAlt" | "apoapsisAlt"> | null,
): OrbitInfo {
  // An absent apsis (no conic, or an escape with no apoapsis) means not orbiting.
  const current = useOrbitSolve();
  const solve = apsides ?? current;
  const bodyName = useBodyName(useParentBodyIndex());
  const PeA = solve?.periapsisAlt ?? undefined;
  const ApA = solve?.apoapsisAlt ?? undefined;

  // The atmosphere height comes off `system.bodies`, so a caller must carry that channel.
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
