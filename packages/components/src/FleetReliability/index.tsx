import {
  registerAugment,
  type SlotProps,
  useTelemetry,
} from "@ksp-gonogo/core";
import { stillTrue } from "@ksp-gonogo/sitrep-sdk";
import {
  Badge,
  Card,
  Cluster,
  heldWord,
  magnitudeOf,
  Stack,
  severityFromStreamStatus,
  worstSeverity,
} from "@ksp-gonogo/ui-kit";
import { heldGrade } from "../shared/heldGrade";
import { AbsenceLine } from "./AbsenceLine";
import { CARD_TONE, isNoteworthy, rowFor } from "./partRows";
import { RepairControl } from "./RepairControl";
import { actionable, repairCostResolver } from "./repair";

/**
 * Reliability / part-failure augment on the `fleet-roster.updates` slot.
 *
 * Source-agnostic: the mod elects ONE `reliability` capability, so this
 * consumes one shape. Anything two backends could disagree about belongs on the
 * wire, never derived here.
 *
 * Active-vessel scoped: `reliability.*` carries no `vesselId`, so only the
 * active vessel's row shows reliability and no fleet-wide roll-up is drawn.
 *
 * Almost everything below is a rule about ABSENCE: no mod, a mod not modelling
 * this save, a probe that could not tell, and a clean craft must not read alike
 * (`coverage-matrix.test.tsx`). Install-level coverage facts render nothing
 * here; they belong on an install-level surface.
 *
 * Currency: `vessel.identity` and `reliability.summary` are facts, read with
 * `stillTrue` (keep counts and roll-ups off the summary). `reliability.parts`
 * is a judgement, read off the observation alone.
 */
type UpdatesProps = SlotProps<"fleet-roster.updates">;

/** `{source} not modelling reliability`, without a leading space when there is no source. */
function prefixed(source: string | null | undefined, rest: string): string {
  return source ? `${source} ${rest}` : rest;
}

export function FleetReliabilityUpdates({ vesselId, compact }: UpdatesProps) {
  const identity = stillTrue(useTelemetry("vessel.identity"), undefined);
  const summaryReading = useTelemetry("reliability.summary");
  const summary = stillTrue(summaryReading, undefined);
  const partsReading = useTelemetry("reliability.parts");
  const crewReading = useTelemetry("vessel.crew");
  const inventoryReading = useTelemetry("vessel.inventory");
  // All three are verdicts, so each is taken from the observation alone.
  const parts =
    partsReading.state === "observed" ? partsReading.value : undefined;
  const crew =
    (crewReading.state === "observed" ? crewReading.value.crew : undefined) ??
    [];
  const stores =
    (inventoryReading.state === "observed"
      ? inventoryReading.value.stores
      : undefined) ?? [];
  const costOf = repairCostResolver(crew, stores);
  // Either channel being old replaces the whole row with a notice.
  const held = heldGrade(partsReading) ?? heldGrade(summaryReading);

  // reliability.* is active-vessel-only.
  if (!identity || identity.vesselId !== vesselId) return null;

  const coverage = summary?.coverage;
  const source = summary?.source;

  /*
   * Every coverage that is not "modeled" renders NOTHING, checked ahead of the
   * staleness gate: each is a constant install fact, not actionable from a
   * roster row, and a permanent badge teaches an operator to stop reading the
   * slot. `system.uplinkHealth` carries it for install-level surfaces.
   */
  if (coverage !== "modeled") return null;

  // Something IS modelling this craft and the held frame is old: the one case worth a word.
  if (held !== undefined) {
    return (
      <AbsenceLine
        severity={severityFromStreamStatus(held)}
        state={heldWord(held)}
        label={`Reliability ${heldWord(held)}`}
      />
    );
  }

  // Something is modelling and its findings are missing: not the same words as a silent channel pair.
  if (parts === undefined) {
    return (
      <AbsenceLine
        severity="offline"
        state={prefixed(source, "parts not reporting")}
        label="Reliability parts not reporting"
      />
    );
  }

  // A modelled craft with no monitored parts, which is not a craft whose parts are all fine.
  if (parts.length === 0) {
    return (
      <AbsenceLine
        severity="info"
        state="no parts monitored"
        label="No parts monitored for reliability"
      />
    );
  }

  const noteworthy = parts.filter(isNoteworthy);
  if (noteworthy.length === 0) return null;

  const rows = noteworthy.map((part) => ({ part, row: rowFor(part) }));
  const severity = worstSeverity(rows.map((entry) => entry.row.severity));
  const atRisk = rows.some(
    (entry) =>
      entry.row.severity === "nogo" || entry.part.condition === "unknown",
  );

  // A wrapping Cluster: an `Inline` does not shrink, and at roster width the badges would crush into circles.
  return (
    <Stack role="group" aria-label="Reliability updates">
      <Cluster justify="start">
        <Badge tone={severity}>
          {`${rows.length} ${atRisk ? "at risk" : "to watch"}`}
        </Badge>
      </Cluster>
      {!compact &&
        rows.map(({ part, row }, index) => (
          // The key falls back to the index, never the title: RO craft carry many identically-titled parts.
          <Card
            key={part.partId ?? `idx-${index}`}
            tone={CARD_TONE[row.severity]}
            title={
              <span title={part.title ?? undefined}>
                {part.title ?? "Unknown part"}
              </span>
            }
            titleRight={<Badge tone={row.severity}>{row.word}</Badge>}
          >
            {row.clause !== undefined && <span>{row.clause}</span>}
            {actionable(part.condition) && part.partId && (
              <RepairControl
                partId={part.partId}
                condition={part.condition}
                repairTrait={part.repairTrait}
                repairLevel={magnitudeOf(part.repairLevel)}
                crew={crew}
                cost={costOf(part)}
              />
            )}
          </Card>
        ))}
    </Stack>
  );
}

registerAugment({
  id: "fleet-reliability-updates",
  augments: "fleet-roster.updates",
  component: FleetReliabilityUpdates,
  channels: [
    "reliability.summary",
    "reliability.parts",
    "vessel.identity",
    "vessel.crew",
    "vessel.inventory",
  ],
});
