import { CORE_UPLINK_CLIENT } from "@ksp-gonogo/core";
import type { SystemBodies } from "@ksp-gonogo/sitrep-sdk";
import { projectionsForBody, type SystemViewProjection } from "./projection";

/*
 * The host's own entries on `system-view.projection`: parent-centred inertial is a named frame, so the picker, resolver and placement all run on a bare stock install.
 * Two entries per body rather than per widget, because `compute` sees Topics and the centred body is config; the host filters by `frameBodyIndex` as it does anyone's entries.
 */

function projectionEntries(
  bodies: SystemBodies | undefined,
): SystemViewProjection[] {
  const entries: SystemViewProjection[] = [];
  for (const body of bodies?.bodies ?? []) {
    // A body listed as its own parent is the root saying so, matching the catalogue's own reading of that case.
    const hasParent =
      body.parentIndex != null && body.parentIndex !== body.index;
    entries.push(...projectionsForBody(body.index, hasParent));
  }
  return entries;
}

CORE_UPLINK_CLIENT.registerContribution({
  id: "system-view-stock-projections",
  contributes: "system-view.projection",
  deps: ["system.bodies"],
  compute: (topics) => projectionEntries(topics["system.bodies"]),
});
