import type { MapPoi } from "@ksp-gonogo/core";
import { registerMapPoiProvider, useTelemetry } from "@ksp-gonogo/core";
import { stillTrue } from "../shared/currency";

/** A confirmed-no-POIs tombstone: a list, and it is empty. */
const EMPTY_POIS: never[] = [];

import { useCommand } from "@ksp-gonogo/sitrep-client";
import { type SpaceCenterPoiEntry, TargetKind } from "@ksp-gonogo/sitrep-sdk";
import { usePanelDelay } from "@ksp-gonogo/ui-kit";
import { useMemo } from "react";

/**
 * Vanilla (stock KSP) map POI provider: registers into the generic
 * `registerMapPoiProvider` registry (`@ksp-gonogo/core`'s `mapPoi.ts`) off
 * the mod's `spaceCenter.pois` stream Topic: every launch site (`ksc`/
 * `launchSite` kinds: stock pad+runway both map to `"ksc"`, see
 * `SpaceCenterViewProvider.BuildPois`) plus every surface contract waypoint
 * currently Active or Offered (`contractTarget` kind). This is core vanilla
 * behaviour (KSC + stock contracts), not a mod, it lives alongside MapView
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
  // A body catalogue: declared unmodellable because it changes when the GAME
  // changes, never continuously, so a stale one is simply the catalogue.
  const bodiesReading = useTelemetry("system.bodies");
  const systemBodies =
    bodiesReading.state === "observed" || bodiesReading.state === "stale"
      ? bodiesReading.value
      : undefined;
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
 * absent (defensive: the wire POCO's fields are all nullable C#-side, even
 * though a real populated entry always carries them). `bodyId` is the
 * caller's already-resolved body NAME, not re-derived here.
 */
function toMapPoi(
  entry: SpaceCenterPoiEntry,
  bodyId: string,
  setTargetCmd: ReturnType<typeof useCommand>,
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

  // Capture the validated position as bare numbers here so the dispatch
  // closure below carries plain values, not the nullable wire quantities.
  const bodyIndex = entry.bodyIndex;
  const latitude = entry.latitude.magnitude;
  const longitude = entry.longitude.magnitude;

  return {
    id: entry.id,
    bodyId,
    // Plain degrees: a POI's position is projected into map pixels, never
    // read as a quantity.
    lat: latitude,
    lon: longitude,
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
        // Rides `useCommand("vessel.target.set")` (a Position-kind SetTarget)
        // instead of the legacy `useExecuteAction` string path. Instant today
        // (the command is not delayed), so `usePanelDelay` consumes the handle
        // and the widget stays behaviour-free.
        run: () =>
          void setTargetCmd.send(
            { kind: TargetKind.Position, bodyIndex, latitude, longitude },
            { label: "Set as Target" },
          ),
      },
    ],
  };
}

registerMapPoiProvider({
  id: "vanilla:spaceCenter",
  // no `requires`, core Sitrep data, always potentially present.
  usePois: (ctx) => {
    // Launch pads, runways and contract targets: fixed ground positions, so a
    // stale list is still where they are. The one exception inside it is a
    // contract DEADLINE, which is an absolute UT and is rendered against the
    // frame's view time by whatever draws it.
    const poisReading = useTelemetry("spaceCenter.pois");
    // A tombstoned POI list means the body has no points of interest, which the
    // `raw === undefined ? undefined : []` return below already distinguishes from a
    // wait. Collapsing the two would leave a body with genuinely no POIs waiting
    // forever.
    const raw = stillTrue(poisReading, EMPTY_POIS);
    const setTargetCmd = useCommand("vessel.target.set");
    usePanelDelay(setTargetCmd);
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
        .map((entry) => toMapPoi(entry, bodyId, setTargetCmd))
        .filter((poi): poi is MapPoi => poi !== null);
    }, [raw, ctx.bodyId, setTargetCmd, nameByIndex]);
  },
});
