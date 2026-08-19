import { CORE_UPLINK_CLIENT } from "@ksp-gonogo/core";
import type { VesselCrew } from "@ksp-gonogo/sitrep-sdk";
import type { BadgeEntry } from "@ksp-gonogo/ui-kit";

// ---------------------------------------------------------------------------
// CrewStatus's own self-contribution to its automatic `crew-status.badges`
// panel-badge slot (contribution-slots-spec §13.2, the same "framework's
// flagship" self-contribution pattern `ShipMap/partMetersContribution.ts`
// uses): an INFO-tone crew-count readout ("3/4 aboard" / "4 aboard"), the
// headcount promoted out of the body's plain-text `ReadoutCaption` line and
// into the header badge row alongside it.
//
// Registered on `CORE_UPLINK_CLIENT` (the built-in half, not a
// `defineUplinkClient(...).registerContribution` Uplink owner) because this
// is a vanilla widget concern with no Uplink involved, exactly like
// `ship-map-part-meters`. Lives on the SAME slot the Kerbalism Uplink's
// `crew-survival-badge` contribution feeds (`mod/GonogoKerbalismUplink/
// client/src/CrewSurvival/badge.ts`): that one is nogo-tone and vessel-danger
// gated (fires only once a kerbal crosses into the critical band), this one
// is info-tone and unconditional (fires whenever a headcount is known at
// all), so the two badges coexist rather than compete, priority/order
// doesn't matter between them.
// ---------------------------------------------------------------------------

/**
 * Pure core, exported so a test can call it directly against a plain
 * `VesselCrew` fixture without going through the contribution registry at
 * all (mirrors the Kerbalism Uplink's own `survivalBadges` pattern,
 * `mod/GonogoKerbalismUplink/client/src/CrewSurvival/badge.ts`).
 */
export function crewAboardBadge(
  crew: VesselCrew | undefined,
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
  compute: (topics) =>
    crewAboardBadge(topics["vessel.crew"] as VesselCrew | undefined),
});
