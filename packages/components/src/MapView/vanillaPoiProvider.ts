import type { MapPoi } from "@ksp-gonogo/core";
import {
  registerMapPoiProvider,
  useExecuteAction,
  useTelemetry,
} from "@ksp-gonogo/core";
import type { SpaceCenterPoiEntry } from "@ksp-gonogo/sitrep-sdk";
import { useMemo } from "react";

/**
 * Vanilla (stock KSP) map POI provider — registers into the generic
 * `registerMapPoiProvider` registry (`@ksp-gonogo/core`'s `mapPoi.ts`) off
 * the mod's `spaceCenter.pois` stream Topic: every launch site (`ksc`/
 * `launchSite` kinds — stock pad+runway both map to `"ksc"`, see
 * `SpaceCenterViewProvider.BuildPois`) plus every surface contract waypoint
 * currently Active or Offered (`contractTarget` kind). This is core vanilla
 * behaviour (KSC + stock contracts), not a mod — it lives alongside MapView
 * rather than in an Uplink package.
 */

/**
 * Resolve a body INDEX (`system.bodies`' stable index, never array
 * position) to its NAME. Reproduces the `bodyIndex -> name` lookup
 * `SystemView`'s `nameByIndex` builds (`SystemView/index.tsx`) rather than
 * importing `@ksp-gonogo/sitrep-client`'s same-named `resolveBodyName`:
 * that helper is module-private and shaped for a derived-channel
 * `DerivedGet` reader, not a plain React-hook call site like this one.
 */
function useBodyNameByIndex(): Map<number, string> {
  const systemBodies = useTelemetry("system.bodies");
  return useMemo(() => {
    const map = new Map<number, string>();
    for (const body of systemBodies?.bodies ?? []) {
      if (body.name != null) map.set(body.index, body.name);
    }
    return map;
  }, [systemBodies]);
}

/**
 * Maps one wire entry to a `MapPoi`, or `null` when a required field is
 * absent (defensive — the wire POCO's fields are all nullable C#-side, even
 * though a real populated entry always carries them). `bodyId` is the
 * caller's already-resolved body NAME, not re-derived here.
 */
function toMapPoi(
  entry: SpaceCenterPoiEntry,
  bodyId: string,
  execute: (action: string) => Promise<void>,
): MapPoi | null {
  if (
    entry.id == null ||
    entry.kind == null ||
    entry.bodyIndex == null ||
    entry.latitude == null ||
    entry.longitude == null ||
    entry.label == null
  ) {
    return null;
  }

  const status: MapPoi["status"] =
    entry.status === "active" || entry.status === "available"
      ? entry.status
      : "info";

  return {
    id: entry.id,
    bodyId,
    lat: entry.latitude,
    lon: entry.longitude,
    kind: entry.kind,
    label: entry.label,
    status,
    meta:
      entry.kind === "contractTarget"
        ? {
            agent: entry.contractAgent,
            fundsAdvance: entry.contractFundsAdvance,
            fundsCompletion: entry.contractFundsCompletion,
            deadline: entry.contractDateDeadline,
          }
        : undefined,
    actions: [
      {
        id: "set-target",
        label: "Set as Target",
        run: () =>
          execute(
            `tar.setTargetPosition[${entry.bodyIndex},${entry.latitude},${entry.longitude}]`,
          ),
      },
    ],
  };
}

registerMapPoiProvider({
  id: "vanilla:spaceCenter",
  // no `requires` — core Sitrep data, always potentially present.
  usePois: (ctx) => {
    const raw = useTelemetry("spaceCenter.pois");
    const execute = useExecuteAction("data");
    const nameByIndex = useBodyNameByIndex();

    return useMemo(() => {
      if (!raw || !ctx.bodyId) return raw === undefined ? undefined : [];
      const bodyId = ctx.bodyId;
      return raw
        .filter(
          (entry) =>
            entry.bodyIndex != null &&
            nameByIndex.get(entry.bodyIndex) === bodyId,
        )
        .map((entry) => toMapPoi(entry, bodyId, execute))
        .filter((poi): poi is MapPoi => poi !== null);
    }, [raw, ctx.bodyId, execute, nameByIndex]);
  },
});
