import { CORE_UPLINK_CLIENT } from "@ksp-gonogo/core";
import type { VesselCrew } from "@ksp-gonogo/sitrep-sdk";
import type { BadgeEntry } from "@ksp-gonogo/ui-kit";

/** Info-tone headcount badge ("3/4 aboard"); coexists with the nogo-tone crew-survival badge an Uplink feeds to the same slot. */
export function crewAboardBadge(
  crew: VesselCrew | null | undefined,
): BadgeEntry[] | null {
  if (!crew) return null;
  const count = crew.count?.magnitude;
  if (count === undefined) return null;
  const capacity = crew.capacity?.magnitude;
  const label =
    capacity !== undefined ? `${count}/${capacity} aboard` : `${count} aboard`;
  return [{ id: "crew-status-aboard", label, tone: "info" }];
}

CORE_UPLINK_CLIENT.registerContribution({
  id: "crew-status-aboard-badge",
  contributes: "crew-status.badges",
  deps: ["vessel.crew"],
  compute: (topics) => crewAboardBadge(topics["vessel.crew"]),
});
