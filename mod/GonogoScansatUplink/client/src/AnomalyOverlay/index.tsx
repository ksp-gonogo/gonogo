// SCANsat anomaly map POI provider.
//
// Registers into the generic `registerMapPoiProvider` registry
// (`@ksp-gonogo/core`'s `mapPoi.ts`) so discovered anomalies render through
// MapView's shared `MapPoiLayer` (packages/components/src/MapView/
// MapPoiLayer.tsx) exactly like every other POI kind (KSC, launch sites,
// contract targets): one hover/action surface, no per-kind bolt-on UI.
//
// Replaces the old `AnomalyOverlay` `map-view.overlay` augment (MapView
// overlay-host foundation plan T-POI-8): that component owned its own
// on-map markers AND a bespoke ranked-by-distance panel
// (`rankAnomaliesByDistance`/`compassPoint`, `geometry.ts`). The panel has
// no replacement here: dropped per the plan's default (POI design spec
// §7.1, left open as a future "generalise a nearby-POI panel" follow-up,
// not rebuilt in this task). What this provider gains over the old augment:
// every anomaly now carries a "Set as Target" action for free.
//
// Presence-gated on `requires: "scansat"`: MapPoiLayer only calls
// `usePois` once `scansat.available` is live, so an install without
// SCANsat never surfaces anomaly markers.

import type { MapPoi, Reading } from "@ksp-gonogo/sitrep-sdk";
import {
  registerMapPoiProvider,
  TargetKind,
  useCommand,
  useTelemetry,
} from "@ksp-gonogo/sitrep-sdk";
import { usePanelDelay } from "@ksp-gonogo/ui-kit";
import { useMemo } from "react";
import { useScanAnomalies } from "../FogReveal/useScanLayers";

/**
 * Resolve a body NAME to its `system.bodies` index, the inverse of
 * `vanillaPoiProvider.ts`'s `useBodyNameByIndex`. Needed only here: an
 * anomaly's body is a name (`useScanAnomalies(bodyName)`), but
 * `SetTargetArgs.Position` (`tar.setTargetPosition[bodyIndex,lat,lon]`)
 * wants the stable index.
 */
/**
 * The value of a FACT: something that stays true until an event changes it, and no
 * event can reach us down a link that is not delivering. `whenConfirmedNothing` is
 * what an `absent` tombstone means here, which is a different answer from `pending`
 * and must not collapse into it.
 */
function stillTrue<T, A>(
  reading: Reading<T>,
  whenConfirmedNothing: A,
): T | A | undefined {
  if (reading.state === "observed") return reading.value;
  if (reading.state === "stale") return reading.value;
  if (reading.state === "reckonable") return reading.value;
  if (reading.state === "absent") return whenConfirmedNothing;
  return undefined;
}

function useBodyIndexByName(): Map<string, number> {
  // The solar system is the least volatile fact on the wire.
  const systemBodies = stillTrue(useTelemetry("system.bodies"), undefined);
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
    const setTargetCmd = useCommand("vessel.target.set");
    usePanelDelay(setTargetCmd);
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
            // Only dispatchable once the body index has resolved; never hand a
            // malformed Position SetTarget to the queue while `system.bodies`
            // is still loading. Rides `useCommand("vessel.target.set")` (a
            // Position-kind SetTarget) instead of the legacy `useExecuteAction`
            // string path; instant today, so `usePanelDelay` consumes the
            // handle and the widget stays behaviour-free.
            actions:
              bodyIndex === undefined
                ? []
                : [
                    {
                      id: "set-target",
                      label: "Set as Target",
                      run: () =>
                        void setTargetCmd.send(
                          {
                            kind: TargetKind.Position,
                            bodyIndex,
                            latitude: a.latitude,
                            longitude: a.longitude,
                          },
                          { label: "Set as Target" },
                        ),
                    },
                  ],
          }),
        );
    }, [anomalies, ctx.bodyId, setTargetCmd, bodyIndexByName]);
  },
});
