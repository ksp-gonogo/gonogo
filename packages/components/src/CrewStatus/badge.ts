import { CORE_UPLINK_CLIENT } from "@ksp-gonogo/core";
import type { Reading, VesselCrew } from "@ksp-gonogo/sitrep-sdk";
import type { BadgeEntry } from "@ksp-gonogo/ui-kit";
import { lastValue } from "../shared/drawnFrom";

/**
 * Info-tone headcount badge ("3/4 aboard"); coexists with the nogo-tone
 * crew-survival badge an Uplink feeds to the same slot. `held` is the reading
 * the count came from, so a held count is drawn as held.
 */
export function crewAboardBadge(
  crew: VesselCrew | null | undefined,
  held?: Reading<unknown>,
): BadgeEntry[] | null {
  if (!crew) return null;
  const count = crew.count?.magnitude;
  if (count === undefined) return null;
  const capacity = crew.capacity?.magnitude;
  const label =
    capacity !== undefined ? `${count}/${capacity} aboard` : `${count} aboard`;
  return [
    {
      id: "crew-status-aboard",
      label,
      tone: "info",
      ...(held === undefined ? {} : { held }),
    },
  ];
}

CORE_UPLINK_CLIENT.registerContribution({
  id: "crew-status-aboard-badge",
  contributes: "crew-status.badges",
  deps: ["vessel.crew"],
  compute: (topics) =>
    crewAboardBadge(lastValue(topics["vessel.crew"]), topics["vessel.crew"]),
});
