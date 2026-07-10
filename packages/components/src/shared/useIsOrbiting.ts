import { getBody, useDataValue } from "@ksp-gonogo/core";
import { useMemo } from "react";

type OrbitInfo = {
  isOrbiting: boolean;
  periapsis: number | undefined;
  apoapsis: number | undefined;
  threshold: number;
};

export function useIsOrbiting(): OrbitInfo {
  const bodyName = useDataValue("data", "v.body");
  const PeA = useDataValue("data", "o.PeA");
  const ApA = useDataValue("data", "o.ApA");

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
