import {
  registerAugment,
  type SlotProps,
  useTelemetry,
} from "@ksp-gonogo/core";
import type { ReliabilityPartEntry } from "@ksp-gonogo/sitrep-sdk";
import { Badge, Inline, Stack } from "@ksp-gonogo/ui-kit";
import { judgeable, notCurrent, stillTrue } from "../shared/currency";

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
 *
 * ## Currency, decided per field
 *
 * Two of the three reads are facts and one is a judgement, and the split is what
 * keeps the marker honest:
 *
 * - `vessel.identity` is a fact. Which craft is active changes when the player
 *   switches craft, an event, and no event reaches us down a link that is not
 *   delivering. Withholding it would unbind the augment from the row it belongs
 *   to and blank a marker about a vessel that is demonstrably still the active
 *   one, so it is read with `stillTrue`
 * - `reliability.summary.source` is a fact of the same kind: the elected backend
 *   is decided when the mod loads and cannot change under flight. Only `source`
 *   is read here; the `malfunction` / `critical` roll-ups on the same record are
 *   judgements, and if this augment ever renders them they go through
 *   `judgeable`
 * - `reliability.parts` is a judgement. Its flags are exactly what drifts while
 *   nobody is looking: TestFlight and Kerbalism both fail parts continuously,
 *   and this augment turns those flags into a severity badge and an "N at risk"
 *   count that the operator reads as the state of the craft now. A held part list
 *   would report a repaired part as broken and, far worse, a craft that has since
 *   failed as clean, so it is read with `judgeable` and the withholding is
 *   captioned rather than silent
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
  const identity = stillTrue(useTelemetry("vessel.identity"), undefined);
  const summary = stillTrue(useTelemetry("reliability.summary"), undefined);
  const partsReading = useTelemetry("reliability.parts");
  const parts = judgeable(partsReading);
  const partsNotCurrent = notCurrent(partsReading);

  // Active-vessel gate: reliability.* is active-vessel-only (see module doc).
  if (!identity || identity.vesselId !== vesselId) return null;
  // An explicit no-reliability backend renders blank, honest (no modelled
  // failures), rather than a stale marker.
  if (summary?.source === "none") return null;

  // The part list went stale, so the failure markers are withheld and this says
  // so on the row. It has to be visible: this augment's every other outcome is
  // `null`, and a silent withholding would leave the roster reading exactly like
  // a craft with nothing wrong with it.
  if (partsNotCurrent) {
    return (
      <Inline gap="sm" role="status" aria-label="Reliability not current">
        <Badge severity="offline">reliability not current</Badge>
      </Inline>
    );
  }

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
