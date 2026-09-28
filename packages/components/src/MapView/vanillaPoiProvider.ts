import type { MapPoi } from "@ksp-gonogo/core";
import { registerMapPoiProvider, useTelemetry } from "@ksp-gonogo/core";

/** A confirmed-no-POIs tombstone: a list, and it is empty. */
const EMPTY_POIS: never[] = [];

import { useCommand } from "@ksp-gonogo/sitrep-client";
import {
  type SpaceCenterPoiEntry,
  stillTrue,
  TargetKind,
} from "@ksp-gonogo/sitrep-sdk";
import { useMemo } from "react";

/**
 * Vanilla (stock KSP) map POI provider off the mod's `spaceCenter.pois`
 * topic: every launch site (pad and runway both map to `"ksc"`) and every
 * Active or Offered surface contract waypoint. Stock behaviour, so it lives
 * beside MapView rather than in an Uplink.
 */
/** Resolve a `system.bodies` index (its stable index, never array position) to its name. */
function useBodyNameByIndex(): Map<number, string> {
  // A body catalogue changes only when the game does, so a stale one is still the catalogue.
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
 * absent (every field is nullable C#-side). `bodyId` is the caller's resolved
 * body name.
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

  // Bare numbers, so the dispatch closure carries plain values rather than nullable wire quantities.
  const bodyIndex = entry.bodyIndex;
  const latitude = entry.latitude.magnitude;
  const longitude = entry.longitude.magnitude;

  return {
    id: entry.id,
    bodyId,
    // Plain degrees: a POI's position is projected into map pixels, never read as a quantity.
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
  // No `requires`: core data, always potentially present.
  usePois: (ctx) => {
    // Fixed ground positions, so a stale list is still where they are; a contract deadline is rendered against the view time by whatever draws it.
    const poisReading = useTelemetry("spaceCenter.pois");
    // A tombstone means no POIs on this body, which must not read as waiting forever.
    const raw = stillTrue(poisReading, EMPTY_POIS);
    const setTargetCmd = useCommand("vessel.target.set");
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
