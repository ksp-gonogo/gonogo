import {
  registerAugment,
  type SlotProps,
  useTelemetry,
} from "@ksp-gonogo/core";
import { type Reading, useCommand } from "@ksp-gonogo/sitrep-client";
import type { CrewMember, RepairCostItem } from "@ksp-gonogo/sitrep-sdk";
import {
  type ReliabilityBudget,
  type ReliabilityPartEntry,
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
 * SOURCE-AGNOSTIC, mod-side: the mod elects ONE `reliability` capability that
 * publishes a single `reliability.summary` / `reliability.parts` pair, fed by
 * whichever backend wins election (TestFlight, Kerbalism, or a vanilla `None`
 * fallback). So this augment consumes ONE shape and never abstracts over two
 * client sources.
 *
 * That sentence read "BY DESIGN" for a while and was an aspiration rather than a
 * description, which is what stopped anyone checking it. Consuming one shape is
 * not the same as being agnostic: every number this augment DERIVES from that
 * shape is a rule it applies to every backend, and the derivation is where one
 * backend's model got in. A `kitsNeeded()` here read Kerbalism's
 * two-for-critical repair-kit rule off `condition` and charged it on every
 * install, so a TestFlight player was asked for a kit their mod never needs and
 * the repair command was disabled when none was aboard. The cost is now the
 * provider's own statement on `repairCost`. **The test for anything added here
 * is not "does it name a mod", it is "could two backends disagree about it": if
 * they could, it belongs on the wire.**
 *
 * ACTIVE-VESSEL SCOPED (carry-gap, intentional): `reliability.*` carries no
 * `vesselId` today (both backends capture off `FlightGlobals.ActiveVessel`
 * only). So this augment attributes reliability to the ACTIVE vessel's row
 * (matching `vessel.identity.vesselId`) and renders nothing on every other row.
 * Exactly one roster row can ever show reliability, and the other N-1 render
 * blank indistinguishably from healthy. That lifts when `reliability.*` carries
 * a `vesselId`, and it is the reason no fleet-wide roll-up is drawn here.
 *
 * ## What it says when it has nothing to say
 *
 * Almost everything below is a rule about ABSENCE, because absence was the bug.
 * Four different situations used to render byte-identical blank: no reliability
 * mod installed, a mod installed and not modelling this save, a probe that could
 * not tell, and a craft with nothing wrong. Only the last of those is good news.
 * The state ladder in the render body keeps them apart, and
 * `coverage-matrix.test.tsx` fails the moment any two read alike.
 *
 * The ONE collapse it accepts is `coverage: "none"`, which renders blank
 * alongside a clean craft. With no provider registered there is nothing
 * installed that could be silently broken, so silence cannot conceal a fault,
 * and a permanent unactionable badge on every stock player's active row trains
 * them to ignore the slot. That install-level distinction is reachable on
 * `system.uplinks` and belongs on an install-level surface, which this is not.
 *
 * ## Currency, decided per topic
 *
 * - `vessel.identity` is a fact. Which craft is active changes on an event, and
 *   no event reaches us down a link that is not delivering; withholding it would
 *   unbind the augment from the row it belongs to. Read with `stillTrue`
 * - `reliability.summary` is now ONLY facts: `source` is fixed when the mod
 *   loads, and `coverage` is an install/save fact. So `stillTrue` is sound here,
 *   which it would not be if a count or a roll-up were still on that record. Do
 *   not put one back
 * - `reliability.parts` is a judgement. Its conditions and numbers are exactly
 *   what drifts while nobody is looking, and this augment turns them into a
 *   severity badge the operator reads as the state of the craft NOW. Read with
 *   `judgeable`, and the withholding is captioned rather than silent
 *
 * The staleness caption sits ABOVE every content row for the same reason: both
 * topics publish from one capture at one UT and go stale together, so a count
 * rendered over a possibly-held frame is worst exactly in the conditions
 * (occlusion, a burn, a link outage) where reliability is being read at all.
 */
type UpdatesProps = SlotProps<"fleet-roster.updates">;

/**
 * The value a VERDICT may be drawn from: current, or modelled forward to the frame.
 * A stale reading gives nothing, because a judgement cannot be dated: the operator
 * reads a band or a pill as the situation NOW.
 */
function judgeable<T>(reading: Reading<T>): T | undefined {
  if (reading.reckoning === "available") return reading.reckoned.value;
  if (reading.state === "observed") return reading.value;
  return undefined;
}

/**
 * The value of a FACT: something that stays true until an event changes it, and no
 * event can reach us down a link that is not delivering. `whenConfirmedNothing` is
 * what an `absent` tombstone means here, which is a different answer from `pending`
 * and must not collapse into it.
 */
function stillTrue<T, A>(
  reading: Reading<T>,
  whenConfirmedNothing: A,
): T | A | undefined {
  if (reading.state === "observed") return reading.value;
  if (reading.state === "stale") return reading.value;
  if (reading.state === "absent") return whenConfirmedNothing;
  return undefined;
}

const seconds = (magnitude: number) => value("s", magnitude);
const count = (magnitude: number) => value("count", magnitude);
const ratio = (magnitude: number) => value("ratio", magnitude);

/** How far into its allowance a budget is, when it says. */
function consumedOf(budget: ReliabilityBudget): number | null {
  return magnitudeOf(budget.consumed);
}

/**
 * Whether this part earns a row: a condition that is not plainly nominal, a
 * budget past its kind's threshold, or a survival probability worth mentioning.
 *
 * An UNRECOGNISED condition selects. A third-party author's value must never be
 * selected-and-then-unrendered, and the row table below is total for the same
 * reason.
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

/**
 * How a part's severity reads on its card's leading edge.
 *
 * <p>Coarser than the badge on purpose. The edge rule is scanned, not read: it
 * answers "is anything here bad" across a stack of cards at a glance, so
 * `caution` and `warning` share a tone. The precise word survives in the badge
 * inside the card, which is where an operator looks once the edge has already
 * caught them.</p>
 */
const CARD_TONE: Record<Severity, ReadoutTone> = {
  critical: "alert",
  warning: "warning",
  caution: "warning",
  offline: "default",
  nominal: "default",
  info: "default",
};

/**
 * How a budget reads out loud, by what crossing its limit MEANS. The verb is the
 * whole point: "due in" and "left" and "past" are three different situations, and
 * a single "78% used" for all of them tells the operator nothing about whether to
 * act. Where the seconds pair is absent and the count pair present, the same
 * sentences take a count instead.
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

/**
 * One row per noteworthy part, first match wins, and TOTAL: every part
 * `isNoteworthy` selected renders something. An open selection with a closed
 * render is how a third-party value gets picked and then drawn as an empty line.
 */
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
    // NEVER a future countdown beside a "service due" badge. Kerbalism's
    // NeedsMaintenance() has two unrelated sources, so a part inspected today and
    // found worn is due NOW with its maintenance clock far in the future, and
    // "service due / service due in 40 d" is a self-contradicting row.
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
      /*
       * The horizon is IN the sentence, not implied: exp(-rate*t) is
       * uninterpretable without t, and two parts' fractions are not comparable
       * unless both horizons are on screen.
       */
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
    // Selected by a budget or a survival read that has since gone. Unreachable
    // by construction; here so the table is total rather than nearly so.
    return { severity: "caution", word: "wear", clause: "flagged" };
  }

  // "unknown", and any value a provider invented that we have never heard of.
  // The catch-all is the point: a condition we cannot interpret is not nominal.
  return { severity: "offline", word: "unreadable", clause: detail };
}

/**
 * What almost every absence renders: a badge naming the SUBSYSTEM and a plain
 * sentence saying what is wrong with it.
 *
 * The split is not cosmetic. A `Badge` is `white-space: nowrap` by design (a
 * status pill that wraps is not a pill), so a sentence long enough to name the
 * backend ran straight off the panel with its last word cut in half at the
 * roster's real width. The badge carries one word and the sentence carries the
 * state, which is also the right reading order on a row that already has other
 * subsystems' markers on it.
 */
function Notice({
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
      gap="sm"
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

/**
 * How many of one named item this kerbal is carrying.
 *
 * <p>The item is named by the PROVIDER, on `repairCost`, so this joins on
 * whatever id it stated rather than on one this file knows. It used to match a
 * literal `"evaRepairKit"`, which is a stock part but only one backend's
 * answer to what a repair costs.</p>
 */
function carriedOf(member: CrewMember, itemName: string): number {
  let held = 0;
  for (const item of member.carrying ?? []) {
    if (item.name === itemName) held += magnitudeOf(item.quantity) ?? 0;
  }
  return held;
}

/**
 * The conditions a repair action applies to, which is more than the broken ones:
 * a service-due part is cleared by the same command.
 *
 * <p>A property of the CONDITION and nothing else. It used to be described as
 * "everything Kerbalism's Repair event will act on", which was the same three
 * values arrived at by reading one backend, and the description is what made the
 * cost arithmetic beside it look equally safe.</p>
 */
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

/**
 * One line of a repair's stated cost, resolved against what is actually aboard.
 *
 * <p>`label` is the item's own display title where something aboard carries one,
 * and its config id otherwise. Neither is a word this file chooses: an id on
 * screen is worse than a title and better than a guess.</p>
 */
interface CostLine {
  name: string;
  label: string;
  needed: number;
  carried: number;
  reserve: number;
}

/**
 * Whether this kerbal is one the provider will accept for this part.
 *
 * <p>Reads the requirement the PROVIDER stated, elevated by the provider for a
 * critical failure, rather than guessing at one. An empty trait means anyone,
 * which is how the provider says "no requirement", and several comma-separated
 * traits mean any of them.</p>
 *
 * <p>Filtering here is not pre-empting the provider's judgement, it is showing
 * it. The provider still decides; this only stops the console offering the
 * operator a choice it already knows will be refused, which under delay costs a
 * round trip to discover.</p>
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
 * The action for one part: repair a failure, or clear a service.
 *
 * <p><b>Collapsed until asked.</b> A roster row carries several parts and each
 * one showing a crew list and a kit ledger turns the row into a form. So the
 * card offers one verb, and the choice of HOW only appears once the operator
 * has said they want to do it.</p>
 *
 * <p><b>Every refusal costs a round trip</b>, exactly as a success does, so the
 * mod's refusals are pre-empted here and shown on a disabled control. Spending
 * the operator's delay to be told "nobody aboard is carrying a kit" is the
 * failure this design exists to avoid.</p>
 *
 * <p><b>The cost sits beside the control</b>, which is this repo's funds rule
 * applied to a different currency: a widget offering to spend something scarce
 * shows the balance in the same widget.</p>
 *
 * <p><b>And the cost is the provider's, never this file's.</b> `cost` is
 * `reliability.parts`' own `repairCost`, empty when the elected backend states
 * none. It used to be derived from `condition` by a `kitsNeeded()` here, which
 * was Kerbalism's two-for-critical rule applied to every install: on a
 * TestFlight one the row asked for a repair kit the mod never needs and
 * disabled the command when none was aboard, and on a Kerbalism install with
 * kits switched off it did the same. An empty cost means nothing is consumed
 * and is not a cost of zero, so it draws no ledger and gates nothing.</p>
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

  /*
   * Default to whoever can act with NO fetch, which is the distinction the
   * crew-versus-vessel inventory split exists for: a kerbal already holding
   * enough needs nothing moved. Offering the first name in the roster instead
   * would hand the operator the worse option by default.
   *
   * Ranked on the FIRST stated item when there is one, which is the whole of
   * every cost anything states today. With no cost stated there is nothing to
   * rank on and roster order stands.
   */
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
      <Cluster justify="start" gap="sm">
        <GhostButton onClick={() => setOpen(true)}>{verb}</GhostButton>
      </Cluster>
    );
  }

  return (
    <Stack gap="xs">
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
  const parts = judgeable(partsReading);
  const crew = judgeable(crewReading)?.crew ?? [];
  const stores = judgeable(inventoryReading)?.stores ?? [];
  /*
   * The reserve a fetch could reach, per item id, and the display title the
   * install gives each one. Part-hosted only: an item in ANOTHER kerbal's
   * pocket is not reachable, because the backends that source a shortfall take
   * it from a cargo hold and never from a colleague.
   */
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
  /**
   * The provider's stated cost, resolved against the vessel. Empty when it
   * states none, which draws no ledger and gates nothing: absent is not zero.
   */
  const costOf = (part: { repairCost?: RepairCostItem[] }): CostLine[] =>
    (part.repairCost ?? []).map((item) => ({
      name: item.name,
      label: titleOf(item.name) ?? item.name,
      needed: magnitudeOf(item.quantity) ?? 0,
      carried: 0,
      reserve: aboard.get(item.name)?.quantity ?? 0,
    }));
  /*
   * Either channel being old is enough to replace the whole row with a notice,
   * so neither arm may fire while a current set can still be drawn. A reading
   * carrying a model is exactly that case: `parts` above is `judgeable` and
   * takes the modelled list, so leaving the reckoning arm in would hide a
   * propagated failure set behind a sentence saying there is none to show.
   */
  const notCurrent =
    (partsReading.state === "stale" && partsReading.reckoning === "none") ||
    (summaryReading.state === "stale" && summaryReading.reckoning === "none");

  // S0. Active-vessel gate: reliability.* is active-vessel-only (see module doc).
  if (!identity || identity.vesselId !== vesselId) return null;

  const coverage = summary?.coverage;
  const source = summary?.source;

  // S6, and it is checked FIRST, ahead of the staleness gate. A vanilla install
  // has no reliability model to lose currency on, so "reliability not current"
  // there would be a notice about data nothing was ever going to publish, on
  // every stock player's active row for the whole of every link outage. Coverage
  // is a fact and survives a stale read, so this is safe to read up here; every
  // OTHER state is still gated on currency below.
  /*
   * Every coverage that is not "modelled" renders NOTHING on this row.
   *
   * They are all facts about the INSTALL rather than about this vessel: nothing
   * is watching, the backend has failures switched off, its provider failed to
   * activate, or it cannot tell which. Each is constant for the whole session
   * and none of them is actionable from a roster row, so a notice for any one
   * is a permanent badge on every active row, which is the thing that teaches
   * an operator to stop reading the slot. That argument was already made and
   * accepted for the vanilla case; it is not weaker for the others, and the
   * distinction it was drawn to protect is not carried on this row.
   *
   * Nor is it lost. `system.uplinkHealth` carries the degraded state and the
   * reason for it, and both the settings panel and the Uplink wizard read it.
   * An install-level fact belongs on an install-level surface.
   *
   * A missing summary lands here too, and should: the reliability slot has
   * nothing to say about a craft it has no reading for, and whether that is a
   * comms problem is the signal status's story to tell, not this widget's.
   */
  if (coverage !== "modeled") return null;

  /*
   * Currency survives, and it is the one thing here that is about the READING
   * rather than the install: something IS modelling this craft and the frame we
   * are holding is old, so the numbers below are real but may no longer be
   * true. That is precisely the case worth a word.
   */
  if (notCurrent) {
    return (
      <Notice
        severity="offline"
        state="not current"
        label="Reliability not current"
      />
    );
  }

  // S7. Something IS modelling, and its part list has not arrived. Deliberately
  // NOT the same words as S2: there the whole channel pair is silent and we do
  // not know whether anything is watching, here we know something is and only
  // its findings are missing. Two situations, two sentences.
  if (parts === undefined) {
    return (
      <Notice
        severity="offline"
        state={prefixed(source, "parts not reporting")}
        label="Reliability parts not reporting"
      />
    );
  }

  // S8. A modelled craft with no monitored parts at all. Different from a
  // modelled craft whose parts are all fine.
  if (parts.length === 0) {
    return (
      <Notice
        severity="info"
        state="no parts monitored"
        label="No parts monitored for reliability"
      />
    );
  }

  const noteworthy = parts.filter(isNoteworthy);
  // S9. Modelled, monitored, and nothing worth saying.
  if (noteworthy.length === 0) return null;

  // S10.
  const rows = noteworthy.map((part) => ({ part, row: rowFor(part) }));
  const severity = worstSeverity(rows.map((entry) => entry.row.severity));
  const atRisk = rows.some(
    (entry) =>
      entry.row.severity === "critical" || entry.part.condition === "unknown",
  );

  /*
   * A WRAPPING Cluster, not an Inline. A roster row is narrow and these
   * sentences are long, and an `Inline` is `flex-shrink: 0` with no
   * `min-width: 0`, so at the roster's real width the words wrapped INSIDE the
   * badge and turned each pill into a circle three lines tall. Wrapping moves
   * an item that does not fit onto the next line instead of crushing it, which
   * keeps the badge a badge and lets the sentence run on.
   */
  return (
    <Stack gap="xs" role="group" aria-label="Reliability updates">
      <Cluster justify="start" gap="sm">
        <Badge severity={severity}>
          {`${rows.length} ${atRisk ? "at risk" : "to watch"}`}
        </Badge>
      </Cluster>
      {!compact &&
        rows.map(({ part, row }, index) => (
          /*
           * The key falls back to the INDEX, never the title: an RO craft
           * carries four identically-titled reaction wheels and six
           * identically-titled ullage motors.
           */
          <Card
            key={part.partId ?? `idx-${index}`}
            tone={CARD_TONE[row.severity]}
          >
            <Stack gap="xs">
              <Cluster justify="between" align="baseline" gap="sm" wrap>
                <span title={part.title ?? undefined}>
                  {part.title ?? "Unknown part"}
                </span>
                <Badge severity={row.severity}>{row.word}</Badge>
              </Cluster>
              {row.clause !== undefined && <span>{row.clause}</span>}
              {actionable(part.condition) && (
                <RepairControl
                  partId={part.partId ?? ""}
                  condition={part.condition}
                  repairTrait={part.repairTrait}
                  repairLevel={magnitudeOf(part.repairLevel)}
                  crew={crew}
                  cost={costOf(part)}
                />
              )}
            </Stack>
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
