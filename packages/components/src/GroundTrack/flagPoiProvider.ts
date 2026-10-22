import type { MapPoi } from "@ksp-gonogo/core";
import { registerMapPoiProvider, useTelemetry } from "@ksp-gonogo/core";
import { type PlantedFlag, stillTrue } from "@ksp-gonogo/sitrep-sdk";
import { useMemo } from "react";
import { plainPosition } from "./vanillaPoiProvider";

/** A list that is confirmed empty: no flag is planted. */
const NO_SITES: never[] = [];

/**
 * Maps one planted flag to a `MapPoi`, or `null` when its place is unread (every
 * wire field is nullable). The site's name is the marker's label.
 */
function toFlagPoi(site: PlantedFlag, bodyId: string): MapPoi | null {
  if (site.siteId == null || site.latitude == null || site.longitude == null) {
    return null;
  }

  const planter = site.plantedBy ? `Planted by ${site.plantedBy}` : undefined;
  return {
    id: `flag:${site.siteId}`,
    bodyId,
    ...plainPosition(site.latitude, site.longitude),
    kind: "flag",
    label: site.name || "Flag",
    detail: planter,
    meta: {
      plaque: site.plaque || undefined,
      planted: site.plantedAt ?? undefined,
    },
  };
}

registerMapPoiProvider({
  id: "vanilla:flags",
  usePois: (ctx) => {
    // A planted flag does not move, so a held list is still where the flags stand.
    const sitesReading = useTelemetry("surface.sites");
    const raw = stillTrue(sitesReading, NO_SITES);

    return useMemo(() => {
      if (!raw || !ctx.bodyId) return raw === undefined ? undefined : [];
      const bodyId = ctx.bodyId;
      return raw
        .filter((site) => site.body === bodyId)
        .map((site) => toFlagPoi(site, bodyId))
        .filter((poi): poi is MapPoi => poi !== null);
    }, [raw, ctx.bodyId]);
  },
});
