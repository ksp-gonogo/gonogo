import { getBody } from "@ksp-gonogo/core";
import { useStream, type VesselState } from "@ksp-gonogo/sitrep-client";
import { useMemo } from "react";

type OrbitInfo = {
  isOrbiting: boolean;
  periapsis: number | undefined;
  apoapsis: number | undefined;
  threshold: number;
};

export function useIsOrbiting(): OrbitInfo {
  // All three reads ride the SDK stream's derived `vessel.state` channel, no
  // legacy `useDataValue("data", ...)` fallback: `parentBodyName` (identity
  // index → `system.bodies` name), and the `periapsisAlt`/`apoapsisAlt` apsis
  // altitudes the client derives off `vessel.orbit`'s elements. `apoapsisAlt`
  // is `undefined` on a hyperbolic/escape orbit (no apoapsis), which the
  // not-orbiting guard below already handles.
  const vesselState = useStream<VesselState>("vessel.state");
  const bodyName = vesselState?.parentBodyName ?? undefined;
  const PeA = vesselState?.periapsisAlt ?? undefined;
  const ApA = vesselState?.apoapsisAlt ?? undefined;

  const body = bodyName ? getBody(bodyName) : undefined;

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
