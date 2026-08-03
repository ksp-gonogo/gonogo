import {
  registerAugment,
  type SlotProps,
  useTelemetry,
} from "@ksp-gonogo/core";
import type { ReliabilityPartEntry } from "@ksp-gonogo/sitrep-sdk";
import { Badge } from "@ksp-gonogo/ui-kit";
import styled from "styled-components";

/**
 * Reliability / part-failure augment on the `fleet-roster.updates` slot.
 *
 * SOURCE-AGNOSTIC BY DESIGN, mod-side: the mod elects ONE `reliability`
 * capability that publishes a single `reliability.summary` / `reliability.parts`
 * pair, fed by whichever backend wins election — TestFlight, Kerbalism, or a
 * vanilla `None` fallback — with a `source` field. So this augment consumes ONE
 * shape and branches on `source` / null-field presence; it never abstracts over
 * two client sources.
 *
 * ACTIVE-VESSEL SCOPED (carry-gap, intentional): `reliability.*` carries no
 * `vesselId` today — both backends capture off `FlightGlobals.ActiveVessel`
 * only. So this augment attributes reliability to the ACTIVE vessel's row
 * (matching `vessel.identity.vesselId`) and renders nothing on every other row.
 * Fleet-wide per-vessel markers land when `reliability.*` carries a `vesselId`
 * (folded into the coordinated per-vessel-data mod pass; see the 2026-08-03
 * validation note).
 */
type UpdatesProps = SlotProps<"fleet-roster.updates">;

function isFailing(part: ReliabilityPartEntry): boolean {
  return Boolean(part.broken || part.critical || part.needsRepair);
}

/** Compact state word for a failing part — critical dominates, then broken. */
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
  // An explicit no-reliability backend → blank, honest (no modelled failures).
  if (summary?.source === "none") return null;

  const failing = (parts ?? []).filter(isFailing);
  if (failing.length === 0) return null;

  const anyCritical = failing.some((part) => part.critical);

  return (
    <FleetReliability role="group" aria-label="Reliability updates">
      <FleetReliability__Marker>
        <Badge tone={anyCritical ? "nogo" : "warn"}>
          {`${failing.length} at risk`}
        </Badge>
      </FleetReliability__Marker>
      {failing.map((part) => (
        <FleetReliability__Row key={part.partId ?? part.title}>
          <Badge tone={part.critical ? "nogo" : "warn"}>
            {partStateLabel(part)}
          </Badge>
          <FleetReliability__Part title={part.title ?? undefined}>
            {part.title ?? "Unknown part"}
          </FleetReliability__Part>
        </FleetReliability__Row>
      ))}
    </FleetReliability>
  );
}

const FleetReliability = styled.div`
  display: flex;
  flex-direction: column;
  gap: var(--space-1, 4px);
`;

const FleetReliability__Marker = styled.div`
  display: flex;
  justify-content: flex-start;
`;

const FleetReliability__Row = styled.div`
  display: flex;
  align-items: center;
  gap: var(--space-2, 8px);
  min-width: 0;
`;

const FleetReliability__Part = styled.span`
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--color-text-secondary, #b8c0cc);
  font-size: var(--font-size-xs, 12px);
`;

registerAugment({
  id: "fleet-reliability-updates",
  augments: "fleet-roster.updates",
  component: FleetReliabilityUpdates,
  channels: ["reliability.summary", "reliability.parts", "vessel.identity"],
});
