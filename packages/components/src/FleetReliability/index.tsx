import {
  registerAugment,
  type SlotProps,
  useTelemetry,
} from "@ksp-gonogo/core";
import { useCommand } from "@ksp-gonogo/sitrep-client";
import type { CrewMember, RepairCostItem } from "@ksp-gonogo/sitrep-sdk";
import {
  type ReliabilityBudget,
  type ReliabilityPartEntry,
  stillTrue,
  value,
} from "@ksp-gonogo/sitrep-sdk";
import {
  Badge,
  Card,
  Cluster,
  CommandButton,
  GhostButton,
  magnitudeOf,
  type ReadoutTone,
  SelectableRow,
  type Severity,
  Stack,
  Unit,
  usePanelDelay,
  worstSeverity,
} from "@ksp-gonogo/ui-kit";
import type { ReactNode } from "react";
import { useState } from "react";
import {
  budgetAttention,
  SURVIVAL_ATTENTION,
  SURVIVAL_WARNING,
} from "./thresholds";

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
 * is a judgement, read off the observation alone, with the withholding
 * captioned above every content row.
 */
type UpdatesProps = SlotProps<"fleet-roster.updates">;

const seconds = (magnitude: number) => value("s", magnitude);
const count = (magnitude: number) => value("count", magnitude);
const ratio = (magnitude: number) => value("ratio", magnitude);

/** How far into its allowance a budget is, when it says. */
function consumedOf(budget: ReliabilityBudget): number | null {
  return magnitudeOf(budget.consumed);
}

/**
 * Whether this part earns a row: a condition not plainly nominal, a budget past
 * its kind's threshold, or a survival probability worth mentioning. An
 * UNRECOGNISED condition selects, and the row table is total so it still renders.
 */
function isNoteworthy(part: ReliabilityPartEntry): boolean {
  if (part.condition !== "nominal") return true;
  for (const budget of part.budgets ?? []) {
    const consumed = consumedOf(budget);
    if (consumed !== null && consumed >= budgetAttention(budget.kind))
      return true;
  }
  const survival = magnitudeOf(part.survival);
  return survival !== null && survival < SURVIVAL_ATTENTION;
}

/** The budget that has gone furthest past its own threshold, if any has. */
function drivingBudget(
  part: ReliabilityPartEntry,
): ReliabilityBudget | undefined {
  let best: ReliabilityBudget | undefined;
  let bestConsumed = -1;
  for (const budget of part.budgets ?? []) {
    const consumed = consumedOf(budget);
    if (consumed === null || consumed < budgetAttention(budget.kind)) continue;
    if (consumed > bestConsumed) {
      best = budget;
      bestConsumed = consumed;
    }
  }
  return best;
}

/** The `schedule` budget, when the provider models one. */
function scheduleBudget(
  part: ReliabilityPartEntry,
): ReliabilityBudget | undefined {
  return (part.budgets ?? []).find((budget) => budget.kind === "schedule");
}

type Row = { severity: Severity; word: string; clause: ReactNode };

/** A card's leading-edge tone: coarser than the badge, since the edge is scanned for "anything bad" and the badge carries the precise word. */
const CARD_TONE: Record<Severity, ReadoutTone> = {
  critical: "alert",
  warning: "warning",
  caution: "warning",
  offline: "default",
  nominal: "default",
  info: "default",
};

/**
 * How a budget reads out loud, by what crossing its limit MEANS: "due in",
 * "left" and "past" are different situations. Without the seconds pair, the
 * same sentences take a count.
 */
function budgetRow(budget: ReliabilityBudget): Row {
  const label = budget.label ?? budget.id ?? "budget";
  const consumed = consumedOf(budget) ?? 0;
  const over = consumed >= 1;

  const usedSeconds = magnitudeOf(budget.usedSeconds);
  const limitSeconds = magnitudeOf(budget.limitSeconds);
  const usedCount = magnitudeOf(budget.usedCount);
  const limitCount = magnitudeOf(budget.limitCount);

  const remaining: ReactNode | undefined =
    usedSeconds !== null && limitSeconds !== null ? (
      <Unit value={seconds(limitSeconds - usedSeconds)} />
    ) : usedCount !== null && limitCount !== null ? (
      <Unit value={count(limitCount - usedCount)} />
    ) : undefined;
  const excess: ReactNode | undefined =
    usedSeconds !== null && limitSeconds !== null ? (
      <Unit value={seconds(usedSeconds - limitSeconds)} />
    ) : usedCount !== null && limitCount !== null ? (
      <Unit value={count(usedCount - limitCount)} />
    ) : undefined;
  const limit: ReactNode | undefined =
    limitSeconds !== null ? (
      <Unit value={seconds(limitSeconds)} />
    ) : limitCount !== null ? (
      <Unit value={count(limitCount)} />
    ) : undefined;

  // No pair at all: only the fraction is known, so that is all it may claim.
  if (remaining === undefined || limit === undefined || excess === undefined) {
    return {
      severity: "caution",
      word: budget.kind === "schedule" ? "service" : "wear",
      clause: (
        <>
          {label} <Unit value={ratio(consumed)} /> used
        </>
      ),
    };
  }

  if (budget.kind === "schedule") {
    return over
      ? {
          severity: "caution",
          word: "service",
          clause: (
            <>
              {label} overdue by {excess}
            </>
          ),
        }
      : {
          severity: "caution",
          word: "service",
          clause: (
            <>
              {label} due in {remaining}
            </>
          ),
        };
  }
  if (budget.kind === "hard-limit") {
    return over
      ? {
          severity: "critical",
          word: "wear",
          clause: (
            <>
              past {label} limit by {excess}
            </>
          ),
        }
      : {
          severity: "warning",
          word: "wear",
          clause: (
            <>
              {remaining} of {limit} {label} left
            </>
          ),
        };
  }
  if (budget.kind === "risk-ramp") {
    return over
      ? {
          severity: "warning",
          word: "wear",
          clause: (
            <>
              past {label} rating by {excess}
            </>
          ),
        }
      : {
          severity: "warning",
          word: "wear",
          clause: (
            <>
              {remaining} of {limit} {label} left
            </>
          ),
        };
  }
  // "advisory", or a kind we have never heard of: the numbers, no verb.
  return {
    severity: "caution",
    word: "wear",
    clause: (
      <>
        {label} <Unit value={ratio(consumed)} /> used
      </>
    ),
  };
}

/** One row per noteworthy part, first match wins, and TOTAL: every selected part renders something. */
function rowFor(part: ReliabilityPartEntry): Row {
  const detail = part.conditionDetail ?? undefined;

  if (part.condition === "failed-critical") {
    return { severity: "critical", word: "critical failure", clause: detail };
  }
  if (part.condition === "failed") {
    return { severity: "critical", word: "failed", clause: detail };
  }
  if (part.condition === "service-due") {
    const schedule = scheduleBudget(part);
    const consumed = schedule ? consumedOf(schedule) : null;
    const used = magnitudeOf(schedule?.usedSeconds);
    const limit = magnitudeOf(schedule?.limitSeconds);
    // Never a future countdown beside "service due": a part inspected and found worn is due NOW whatever its maintenance clock says.
    const overdue =
      consumed !== null && consumed >= 1 && used !== null && limit !== null ? (
        <>
          overdue by <Unit value={seconds(used - limit)} />
        </>
      ) : undefined;
    return {
      severity: "caution",
      word: "service due",
      clause:
        detail && overdue ? (
          <>
            {detail} · {overdue}
          </>
        ) : (
          (overdue ?? detail)
        ),
    };
  }
  if (part.condition === "nominal") {
    const budget = drivingBudget(part);
    if (budget) return budgetRow(budget);

    const survival = magnitudeOf(part.survival);
    const horizon = magnitudeOf(part.survivalHorizonSeconds);
    if (survival !== null && horizon !== null) {
      // The horizon is IN the sentence: exp(-rate*t) is uninterpretable without t.
      return {
        severity: survival >= SURVIVAL_WARNING ? "caution" : "warning",
        word: "survival",
        clause: (
          <>
            <Unit value={ratio(survival)} /> to survive{" "}
            <Unit value={seconds(horizon)} /> of operation
          </>
        ),
      };
    }
    // Unreachable by construction; here so the table is total.
    return { severity: "caution", word: "wear", clause: "flagged" };
  }

  // "unknown", or any value we have never heard of: a condition we cannot interpret is not nominal.
  return { severity: "offline", word: "unreadable", clause: detail };
}

/**
 * A badge naming the SUBSYSTEM and a plain sentence saying what is wrong. A
 * `Badge` is nowrap by design, so the sentence stays outside it.
 */
function AbsenceLine({
  severity,
  state,
  label,
}: {
  severity: Severity;
  /** The sentence beside the badge: what is wrong, in the operator's terms. */
  state: string;
  label: string;
}) {
  return (
    <Cluster
      justify="start"
      align="baseline"
      wrap
      role="status"
      aria-label={label}
    >
      <Badge severity={severity}>reliability</Badge>
      <span>{state}</span>
    </Cluster>
  );
}

/** `{source} not modelling reliability`, without a leading space when there is no source. */
function prefixed(source: string | null | undefined, rest: string): string {
  return source ? `${source} ${rest}` : rest;
}

/** How many of one item this kerbal carries, joined on the id the provider stated on `repairCost`. */
function carriedOf(member: CrewMember, itemName: string): number {
  let held = 0;
  for (const item of member.carrying ?? []) {
    if (item.name === itemName) held += magnitudeOf(item.quantity) ?? 0;
  }
  return held;
}

/** The conditions a repair action applies to: a service-due part is cleared by the same command. */
function actionable(condition: string | null | undefined): boolean {
  return (
    condition === "failed" ||
    condition === "failed-critical" ||
    condition === "service-due"
  );
}

/** `Repair` for a failure, `Service` for a part that is merely due one. */
function verbFor(condition: string | null | undefined): string {
  return condition === "service-due" ? "Service" : "Repair";
}

/** One line of a repair's stated cost; `label` is the item's display title where known, its config id otherwise. */
interface CostLine {
  name: string;
  label: string;
  needed: number;
  carried: number;
  reserve: number;
}

/**
 * Whether the provider will accept this kerbal for this part, off the
 * requirement it stated: an empty trait means anyone, comma-separated traits
 * mean any of them. Filtering spares the operator a round trip to a known
 * refusal.
 */
function mayAct(
  member: CrewMember,
  trait: string | null | undefined,
  level: number | null | undefined,
): boolean {
  if (trait) {
    const accepted = trait.split(",").map((t) => t.trim().toLowerCase());
    if (!accepted.includes((member.trait ?? "").toLowerCase())) return false;
  }
  if (level != null && (magnitudeOf(member.experienceLevel) ?? 0) < level) {
    return false;
  }
  return true;
}

/**
 * The action for one part: repair a failure, or clear a service. Collapsed
 * until asked, so a row does not become a form. Every known refusal is shown on
 * a disabled control, since under delay each costs a round trip. The cost sits
 * beside the control and is the provider's own `repairCost`; an empty cost is
 * not a cost of zero, so it draws no ledger and gates nothing.
 */
function RepairControl({
  partId,
  condition,
  repairTrait,
  repairLevel,
  crew,
  cost,
}: {
  partId: string;
  condition: string | null | undefined;
  repairTrait: string | null | undefined;
  repairLevel: number | null | undefined;
  crew: CrewMember[];
  cost: CostLine[];
}) {
  const repair = useCommand("vessel.repair");
  usePanelDelay(repair);
  const [open, setOpen] = useState(false);
  const [chosen, setChosen] = useState<string | null>(null);

  const verb = verbFor(condition);

  // Default to whoever can act with NO fetch, ranked on the first stated item; with no cost stated, roster order stands.
  const rankOn = cost[0]?.name;
  const eligible = crew.filter((c) => mayAct(c, repairTrait, repairLevel));
  const readiest = rankOn
    ? eligible
        .slice()
        .sort((a, b) => carriedOf(b, rankOn) - carriedOf(a, rankOn))[0]
    : eligible[0];
  const performer = chosen ?? readiest?.name ?? null;
  const acting = eligible.find((c) => c.name === performer);

  /** Per stated item: what this performer could reach without another trip. */
  const lines = cost.map((line) => {
    const held = acting ? carriedOf(acting, line.name) : 0;
    return { ...line, carried: held, reachable: held + line.reserve };
  });
  const short = lines.find((line) => line.reachable < line.needed);

  const requirement = repairTrait
    ? `${repairTrait}${repairLevel != null ? ` level ${repairLevel}` : ""}`
    : null;
  const refusal =
    eligible.length === 0
      ? requirement
        ? `Needs ${requirement}, and nobody aboard qualifies`
        : "Nobody is aboard to do it"
      : short
        ? `Needs ${short.needed} ${short.label}, and ${short.reachable} can be reached`
        : null;

  if (!open) {
    return (
      <Cluster justify="start">
        <GhostButton onClick={() => setOpen(true)}>{verb}</GhostButton>
      </Cluster>
    );
  }

  return (
    <Stack>
      {lines.map((line) => (
        <span key={line.name}>
          {`${line.needed} ${line.label} · ${line.carried} carried · ${line.reserve} aboard`}
        </span>
      ))}
      {eligible.map((member) => (
        <SelectableRow
          key={member.name ?? "unknown"}
          selected={member.name === performer}
          onClick={() => setChosen(member.name ?? null)}
        >
          {rankOn
            ? `${member.name ?? "Unknown"} · ${carriedOf(member, rankOn)} carried`
            : (member.name ?? "Unknown")}
        </SelectableRow>
      ))}
      {refusal && <span>{refusal}</span>}
      <CommandButton
        handle={repair}
        args={{ partId, crewName: performer ?? "" }}
        size="sm"
        commandLabel={`${verb} with ${performer ?? "nobody"}`}
        label={verb}
        confirmLabel="Confirm"
        pendingLabel={`${verb}...`}
        disabled={refusal !== null}
        title={refusal ?? undefined}
      />
    </Stack>
  );
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
  // The reserve a fetch could reach: part-hosted only, since no backend takes an item from another kerbal's pocket.
  const aboard = new Map<string, { quantity: number; title?: string | null }>();
  for (const store of stores) {
    for (const item of store.items ?? []) {
      const seen = aboard.get(item.name);
      aboard.set(item.name, {
        quantity: (seen?.quantity ?? 0) + (magnitudeOf(item.quantity) ?? 0),
        title: seen?.title ?? item.title,
      });
    }
  }
  /** The title anything aboard gives this item id, crew pockets included. */
  const titleOf = (name: string): string | undefined => {
    const stored = aboard.get(name)?.title;
    if (stored) return stored;
    for (const member of crew) {
      for (const item of member.carrying ?? []) {
        if (item.name === name && item.title) return item.title;
      }
    }
    return undefined;
  };
  /** The provider's stated cost resolved against the vessel; empty draws no ledger and gates nothing. */
  const costOf = (part: { repairCost?: RepairCostItem[] | null }): CostLine[] =>
    (part.repairCost ?? []).map((item) => ({
      name: item.name,
      label: titleOf(item.name) ?? item.name,
      needed: magnitudeOf(item.quantity) ?? 0,
      carried: 0,
      reserve: aboard.get(item.name)?.quantity ?? 0,
    }));
  // Either channel being old replaces the whole row with a notice.
  const notCurrent =
    partsReading.state === "stale" || summaryReading.state === "stale";

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
  if (notCurrent) {
    return (
      <AbsenceLine
        severity="offline"
        state="not current"
        label="Reliability not current"
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
      entry.row.severity === "critical" || entry.part.condition === "unknown",
  );

  // A wrapping Cluster: an `Inline` does not shrink, and at roster width the badges would crush into circles.
  return (
    <Stack role="group" aria-label="Reliability updates">
      <Cluster justify="start">
        <Badge severity={severity}>
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
            titleRight={<Badge severity={row.severity}>{row.word}</Badge>}
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
