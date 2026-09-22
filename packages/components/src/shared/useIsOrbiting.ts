import { useStream, type VesselState } from "@ksp-gonogo/sitrep-client";
import type { VesselIdentity } from "@ksp-gonogo/sitrep-sdk";
import { useMemo } from "react";
import { useBodyName } from "./useBodyName";
import { useStreamBody } from "./useStreamBody";

type OrbitInfo = {
  isOrbiting: boolean;
  periapsis: number | undefined;
  apoapsis: number | undefined;
  threshold: number;
};

export function useIsOrbiting(): OrbitInfo {
  // `apoapsisAlt` is `undefined` on a hyperbolic or escape orbit, which has no
  // apoapsis, and the not-orbiting guard below already handles that.
  const vesselState = useStream<VesselState>("vessel.state");
  const bodyName = useBodyName(
    useStream<VesselIdentity>("vessel.identity")?.parentBodyIndex,
  );
  const PeA = vesselState?.periapsisAlt ?? undefined;
  const ApA = vesselState?.apoapsisAlt ?? undefined;

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
