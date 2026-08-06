import {
  registerAugment,
  type SlotProps,
  useTelemetry,
} from "@ksp-gonogo/core";
import type { ReliabilityPartEntry } from "@ksp-gonogo/sitrep-sdk";
import { Badge, Inline, Stack } from "@ksp-gonogo/ui-kit";

/**
 * Reliability / part-failure augment on the `fleet-roster.updates` slot.
 *
 * SOURCE-AGNOSTIC BY DESIGN, mod-side: the mod elects ONE `reliability`
 * capability that publishes a single `reliability.summary` / `reliability.parts`
 * pair, fed by whichever backend wins election (TestFlight, Kerbalism, or a
 * vanilla `None` fallback), with a `source` field. So this augment consumes ONE
 * shape and branches on `source` / null-field presence; it never abstracts over
 * two client sources.
 *
 * ACTIVE-VESSEL SCOPED (carry-gap, intentional): `reliability.*` carries no
 * `vesselId` today (both backends capture off `FlightGlobals.ActiveVessel`
 * only). So this augment attributes reliability to the ACTIVE vessel's row
 * (matching `vessel.identity.vesselId`) and renders nothing on every other row.
 * Fleet-wide per-vessel markers land when `reliability.*` carries a `vesselId`
 * (folded into the coordinated per-vessel-data mod pass; see the 2026-08-03
 * validation note).
 */
type UpdatesProps = SlotProps<"fleet-roster.updates">;

function isFailing(part: ReliabilityPartEntry): boolean {
  return Boolean(part.broken || part.critical || part.needsRepair);
}

/** Compact state word for a failing part: critical dominates, then broken. */
function partStateLabel(part: ReliabilityPartEntry): string {
  if (part.critical) return "critical";
  if (part.broken) return "broken";
  return "repair";
}

export function FleetReliabilityUpdates({ vesselId }: UpdatesProps) {
  const identity = useTelemetry("vessel.identity");
  const summary = useTelemetry("reliability.summary");
  const parts = useTelemetry("reliability.parts");

  // Active-vessel gate: reliability.* is active-vessel-only (see module doc).
  if (!identity || identity.vesselId !== vesselId) return null;
  // An explicit no-reliability backend renders blank, honest (no modelled
  // failures), rather than a stale marker.
  if (summary?.source === "none") return null;

  const failing = (parts ?? []).filter(isFailing);
  if (failing.length === 0) return null;

  const anyCritical = failing.some((part) => part.critical);

  return (
    <Stack gap="xs" role="group" aria-label="Reliability updates">
      <Badge severity={anyCritical ? "critical" : "warning"}>
        {`${failing.length} at risk`}
      </Badge>
      {failing.map((part) => (
        <Inline key={part.partId ?? part.title} gap="sm">
          <Badge severity={part.critical ? "critical" : "warning"}>
            {partStateLabel(part)}
          </Badge>
          <span title={part.title ?? undefined}>
            {part.title ?? "Unknown part"}
          </span>
        </Inline>
      ))}
    </Stack>
  );
}

registerAugment({
  id: "fleet-reliability-updates",
  augments: "fleet-roster.updates",
  component: FleetReliabilityUpdates,
  channels: ["reliability.summary", "reliability.parts", "vessel.identity"],
});
