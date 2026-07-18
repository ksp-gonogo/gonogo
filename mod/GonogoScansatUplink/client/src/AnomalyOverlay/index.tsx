// SCANsat anomaly map POI provider.
//
// Registers into the generic `registerMapPoiProvider` registry
// (`@ksp-gonogo/core`'s `mapPoi.ts`) so discovered anomalies render through
// MapView's shared `MapPoiLayer` (packages/components/src/MapView/
// MapPoiLayer.tsx) exactly like every other POI kind (KSC, launch sites,
// contract targets) — one hover/action surface, no per-kind bolt-on UI.
//
// Replaces the old `AnomalyOverlay` `map-view.overlay` augment (MapView
// overlay-host foundation plan T-POI-8): that component owned its own
// on-map markers AND a bespoke ranked-by-distance panel
// (`rankAnomaliesByDistance`/`compassPoint`, `geometry.ts`). The panel has
// no replacement here — dropped per the plan's default (POI design spec
// §7.1, left open as a future "generalise a nearby-POI panel" follow-up,
// not rebuilt in this task). What this provider gains over the old augment:
// every anomaly now carries a "Set as Target" action for free.
//
// Presence-gated on `requires: "scansat"`: MapPoiLayer only calls
// `usePois` once `scansat.available` is live, so an install without
// SCANsat never surfaces anomaly markers.

import type { MapPoi } from "@ksp-gonogo/core";
import {
  registerMapPoiProvider,
  useExecuteAction,
  useTelemetry,
} from "@ksp-gonogo/core";
import { useMemo } from "react";
import { useScanAnomalies } from "../FogReveal/useScanLayers";

/**
 * Resolve a body NAME to its `system.bodies` index — the inverse of
 * `vanillaPoiProvider.ts`'s `useBodyNameByIndex`. Needed only here: an
 * anomaly's body is a name (`useScanAnomalies(bodyName)`), but
 * `SetTargetArgs.Position` (`tar.setTargetPosition[bodyIndex,lat,lon]`)
 * wants the stable index.
 */
function useBodyIndexByName(): Map<string, number> {
  const systemBodies = useTelemetry("system.bodies");
  return useMemo(() => {
    const map = new Map<string, number>();
    for (const body of systemBodies?.bodies ?? []) {
      if (body.name != null && body.index != null) {
        map.set(body.name, body.index);
      }
    }
    return map;
  }, [systemBodies]);
}

registerMapPoiProvider({
  id: "scansat:anomalies",
  requires: "scansat",
  usePois: (ctx) => {
    const anomalies = useScanAnomalies(ctx.bodyId);
    const execute = useExecuteAction("data");
    const bodyIndexByName = useBodyIndexByName();

    return useMemo(() => {
      if (!Array.isArray(anomalies) || !ctx.bodyId) return [];
      const bodyId = ctx.bodyId;
      const bodyIndex = bodyIndexByName.get(bodyId);

      return anomalies
        .filter((a) => a.known)
        .map(
          (a): MapPoi => ({
            id: `anomaly:${a.name}-${a.latitude}-${a.longitude}`,
            bodyId,
            lat: a.latitude,
            lon: a.longitude,
            kind: "anomaly",
            label: a.detail ? a.name : "(unknown)",
            status: "info",
            meta: { known: a.known, detail: a.detail },
            // Only dispatchable once the body index has resolved — never
            // hand a malformed `tar.setTargetPosition[undefined,...]` command
            // to the queue while `system.bodies` is still loading.
            actions:
              bodyIndex === undefined
                ? []
                : [
                    {
                      id: "set-target",
                      label: "Set as Target",
                      run: () =>
                        execute(
                          `tar.setTargetPosition[${bodyIndex},${a.latitude},${a.longitude}]`,
                        ),
                    },
                  ],
          }),
        );
    }, [anomalies, ctx.bodyId, execute, bodyIndexByName]);
  },
});
