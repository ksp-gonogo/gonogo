import { CORE_UPLINK_CLIENT } from "@ksp-gonogo/core";
import type { SystemBodies } from "@ksp-gonogo/sitrep-sdk";
import { projectionsForBody, type SystemViewProjection } from "./projection";

// ---------------------------------------------------------------------------
// The host's own entries on `system-view.projection`.
//
// SystemView under a bare stock install draws in parent-centred inertial
// coordinates, which is a FRAME, and this is the file that says so. It was never
// named before, and leaving it unnamed is what turned every question downstream
// into "is there a projection" rather than "which projection", which is a host
// branching on the presence of a contribution in six places. Naming it means the
// seam is travelled with no Uplinks installed at all: the picker has entries, the
// resolver runs, the diagram places every position through it, and a third party's
// entry arrives on a path that has been exercised since the day it was built.
//
// Two entries per body rather than two per widget, because `compute` is a pure
// function of Topics and which body the diagram is centred on is a config value.
// The host takes the ones whose `frameBodyIndex` matches the body it is drawing
// about, which is exactly the filter it applies to anybody else's entries.
// ---------------------------------------------------------------------------

function projectionEntries(
  bodies: SystemBodies | undefined,
): SystemViewProjection[] {
  const entries: SystemViewProjection[] = [];
  for (const body of bodies?.bodies ?? []) {
    // A body listed as its own parent is the root saying so, matching the
    // catalogue's own reading of that case.
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
