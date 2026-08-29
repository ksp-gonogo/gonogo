import {
  registerAugment,
  type SlotProps,
  useTelemetry,
} from "@ksp-gonogo/core";
import type { Reading } from "@ksp-gonogo/sitrep-client";
import {
  type ReliabilityBudget,
  type ReliabilityPartEntry,
  value,
} from "@ksp-gonogo/sitrep-sdk";
import {
  Badge,
  Cluster,
  magnitudeOf,
  type Severity,
  Stack,
  Unit,
  worstSeverity,
} from "@ksp-gonogo/ui-kit";
import type { ReactNode } from "react";
import {
  budgetAttention,
  SURVIVAL_ATTENTION,
  SURVIVAL_WARNING,
} from "./thresholds";

/**
 * Reliability / part-failure augment on the `fleet-roster.updates` slot.
 *
 * SOURCE-AGNOSTIC BY DESIGN, mod-side: the mod elects ONE `reliability`
 * capability that publishes a single `reliability.summary` / `reliability.parts`
 * pair, fed by whichever backend wins election (TestFlight, Kerbalism, or a
 * vanilla `None` fallback). So this augment consumes ONE shape and never
 * abstracts over two client sources.
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
  if (reading.state === "observed") return reading.value;
  if (reading.state === "reckonable") return reading.reckoned.value;
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
  if (reading.state === "reckonable") return reading.value;
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

export function FleetReliabilityUpdates({ vesselId, compact }: UpdatesProps) {
  const identity = stillTrue(useTelemetry("vessel.identity"), undefined);
  const summaryReading = useTelemetry("reliability.summary");
  const summary = stillTrue(summaryReading, undefined);
  const partsReading = useTelemetry("reliability.parts");
  const parts = judgeable(partsReading);
  const notCurrent =
    partsReading.state === "stale" || summaryReading.state === "stale";

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
          <Cluster
            key={part.partId ?? `idx-${index}`}
            justify="start"
            align="baseline"
            gap="sm"
            wrap
          >
            <Badge severity={row.severity}>{row.word}</Badge>
            <span title={part.title ?? undefined}>
              {part.title ?? "Unknown part"}
            </span>
            {row.clause !== undefined && <span>· {row.clause}</span>}
          </Cluster>
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
