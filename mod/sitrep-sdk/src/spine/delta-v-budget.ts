import { observedAt } from "../reading";
import { isValue, value } from "../unit-system/value";
import type { Value } from "../value";
import type { Reading } from "./client-reading";
import { CORE_UPLINK_CLIENT } from "./uplink-clients";

// ---------------------------------------------------------------------------
// "How much ΔV have we got?", answered once, in one place.
//
// Four widgets asked it and got three different answers, and the answers could
// disagree about the same craft in flight:
//
//   FuelStatus        `parseStages` for the rows, `dv.summary.totalDv*` for the
//                     total, `judgeable` for the arm (withholds when stale)
//   ManeuverPlanner   `useVesselDeltaV`, which SUMS `dv.stages` client-side for
//                     the total, spells an absent per-stage field `0`, and also
//                     withholds when stale
//   TransferWindow    `dv.summary.totalDvVac` raw, carried and dated
//   LandingStatus     the active `dv.stages` row for the rocket-equation solve,
//                     `dv.summary` as the whole-vessel fallback
//
// Each of the three got a different third of it right, so this takes one third
// from each:
//
// THE TOTAL COMES OFF THE WIRE, never from summing `dv.stages`. The two are not
// the same figure. `dv.stages` is built from `VesselDeltaV.OperatingStageInfo`
// (KspHost.BuildDeltaV), which in flight is filtered to the stages at or below
// `StageManager.CurrentStage`; `dv.summary.totalDv*` is `TotalDeltaVVac`/ASL/
// Actual, accumulated over `WorkingStageInfo`, which is unfiltered. Summing the
// one and presenting it as the other is a client-side re-derivation of a number
// the game already computed, off a different list, and it under-reports.
//
// AN ABSENT PER-STAGE FIELD IS `NaN`, never `0`. They are opposite facts: a
// stage with no engine has no ΔV figure, and a spent stage has 0 m/s. Spelling
// both `0` is the same mistake `useVesselDeltaV` fixed one level up when it made
// its total nullable, left unfixed one level down. NaN is affordable here
// precisely BECAUSE the total no longer comes from summing these rows.
//
// THE BUDGET IS CARRIED AND DATED, never withheld. A ΔV budget only falls by
// burning and only rises by staging or docking, all of which are events the
// operator caused, so a dated budget is still the budget and wants a caption
// rather than a blank. Withholding is also the DANGEROUS direction: ManeuverPlanner
// disables its commit only on `feasible === false`, so a budget that goes
// `undefined` mid-blackout turns a craft that is demonstrably short into one we
// merely have no opinion about, and re-enables the button. `budget` below carries
// the arm and the age so a consumer can hollow a verdict instead of losing it.
// ---------------------------------------------------------------------------

/**
 * One stage's row, field-names reconciled.
 *
 * Names match `@ksp-gonogo/core`'s historical `StageInfo` exactly, so the
 * widgets that already render off that shape are a drop-in. The wire disagrees
 * with itself about them: the mod's `StageDeltaVEntry` streams `dvVac` / `dvAsl`
 * / `dvActual` / `twr*` / `thrustAsl`, and never carries `stageMass` or `isp*`
 * at all.
 *
 * Every field is a magnitude rather than a `Value`: these feed bar scaling, a
 * rocket-equation solve and `Math.max`, all of which are arithmetic on numbers,
 * and the row is where that conversion has always happened. **`NaN` means the
 * wire carried no figure**, which is why every reader filters on
 * `Number.isFinite` rather than truthiness.
 */
export interface DeltaVStage {
  stage: number;
  stageMass: number;
  dryMass: number;
  fuelMass: number;
  startMass: number;
  endMass: number;
  burnTime: number;
  deltaVVac: number;
  deltaVASL: number;
  deltaVActual: number;
  TWRVac: number;
  TWRASL: number;
  TWRActual: number;
  ispVac: number;
  ispASL: number;
  ispActual: number;
  thrustVac: number;
  thrustASL: number;
  thrustActual: number;
}

/**
 * Where the budget came from and how old it is.
 *
 * Its own provenance rather than a nested `Reading`, for the reason
 * `ReadingDep`'s doc gives and `SHIP_SYSTEMS.levels` already follows: a
 * `Reading` is one Topic's currency, and a budget joined across `dv.summary`,
 * `dv.stages` and `vessel.structure` is not one Topic's anything.
 */
export interface BudgetProvenance {
  /** The reading arm `dv.summary` arrived on. */
  state: "pending" | "absent" | "observed" | "stale" | "reckonable";
  /** UT the summary was observed at; undefined when nothing has been observed. */
  asOfUt: Value<"ut"> | undefined;
  /** Seconds between that observation and the frame this was derived for. */
  ageSec: number | undefined;
  /**
   * The stock ΔV sim confirmed it has no figure for this craft, as opposed to
   * none having arrived. A craft with no engines really has no budget; a craft
   * we have not heard from has one we do not know. They must not render alike.
   */
  confirmedAbsent: boolean;
}

export interface DeltaVBudget {
  /**
   * Vessel-total ΔV per situation, straight off `dv.summary`: the game's own
   * accumulator, never a client-side sum of {@link stages}.
   *
   * `null` means no usable figure, which is NOT `0`: a spent craft really has
   * 0 m/s and that is a statement about the vessel, while `null` is a statement
   * about the link. A caller must branch, and the branch is where "we do not
   * know" gets said out loud instead of being spelled `0`.
   */
  totalVac: Value<"m/s"> | null;
  totalAsl: Value<"m/s"> | null;
  totalActual: Value<"m/s"> | null;
  /** Total burn time across the budget, or `null` when the wire carries none. */
  totalBurnTime: Value<"s"> | null;
  /** How many stages the summary counted, or `null`. Not `stages.length`: see {@link stages}. */
  stageCount: Value<"count"> | null;
  /**
   * Per-stage rows in wire order (high stage number first, matching the
   * stack-top-down render order).
   *
   * Empty is NOT a zero-ΔV vessel: `dv.stages` is null-not-empty when the stock
   * sim has nothing (`StageDeltaVViewProvider.BuildStages`), so an array that
   * arrived with no entries still means "no figure to break down".
   */
  stages: DeltaVStage[];
  /**
   * The row whose `stage` matches `vessel.structure.currentStage`: the engines
   * actually flying right now, and the only ones whose mass ratio fixes a real
   * exhaust velocity. `null` when no row matches or the structure has not
   * arrived.
   */
  activeStage: DeltaVStage | null;
  budget: BudgetProvenance;
}

/** The wire shape of a `dv.stages` row, as either transport may send it. */
type StageWireEntry = Record<string, unknown>;

/** A number, a `Value`'s magnitude, or `NaN` when the field carries neither. */
function magnitudeOrNaN(raw: unknown): number {
  if (typeof raw === "number") return raw;
  if (isValue(raw)) return raw.magnitude;
  return Number.NaN;
}

/** The first of `keys` carrying a finite figure, or `NaN`. */
function field(entry: StageWireEntry, ...keys: string[]): number {
  for (const key of keys) {
    const magnitude = magnitudeOrNaN(entry[key]);
    if (Number.isFinite(magnitude)) return magnitude;
  }
  return Number.NaN;
}

/**
 * One wire row to a {@link DeltaVStage}. Exported so a widget test can build a
 * row without a live evaluator.
 */
export function normaliseStage(raw: unknown): DeltaVStage | null {
  if (!raw || typeof raw !== "object") return null;
  const e = raw as StageWireEntry;
  return {
    stage: field(e, "stage"),
    stageMass: field(e, "stageMass"),
    dryMass: field(e, "dryMass"),
    fuelMass: field(e, "fuelMass"),
    startMass: field(e, "startMass"),
    endMass: field(e, "endMass"),
    burnTime: field(e, "burnTime"),
    deltaVVac: field(e, "deltaVVac", "dvVac"),
    deltaVASL: field(e, "deltaVASL", "dvAsl"),
    deltaVActual: field(e, "deltaVActual", "dvActual"),
    TWRVac: field(e, "TWRVac", "twrVac"),
    TWRASL: field(e, "TWRASL", "twrAsl"),
    TWRActual: field(e, "TWRActual", "twrActual"),
    ispVac: field(e, "ispVac"),
    ispASL: field(e, "ispASL"),
    ispActual: field(e, "ispActual"),
    thrustVac: field(e, "thrustVac"),
    thrustASL: field(e, "thrustASL", "thrustAsl"),
    thrustActual: field(e, "thrustActual"),
  };
}

/** A wire total to a `Value<"m/s">`, or `null` when there is no usable figure. */
function totalOf<U extends "m/s" | "s" | "count">(
  raw: unknown,
  unit: U,
): Value<U> | null {
  const magnitude = magnitudeOrNaN(raw);
  return Number.isFinite(magnitude) ? value(unit, magnitude) : null;
}

/** The wire subset of `dv.summary` this derivation reads. */
interface SummaryWire {
  stageCount?: unknown;
  totalDvVac?: unknown;
  totalDvAsl?: unknown;
  totalDvActual?: unknown;
  totalBurnTime?: unknown;
}

const NO_BUDGET: DeltaVBudget = {
  totalVac: null,
  totalAsl: null,
  totalActual: null,
  totalBurnTime: null,
  stageCount: null,
  stages: [],
  activeStage: null,
  budget: {
    state: "pending",
    asOfUt: undefined,
    ageSec: undefined,
    confirmedAbsent: false,
  },
};

/**
 * The whole derivation, pure. Exported so a test can exercise it directly
 * without a live evaluator, mirroring Kerbalism's `deriveCrewSurvival`.
 */
export function deriveDeltaVBudget(
  summaryReading: Reading<SummaryWire>,
  stagesRaw: unknown,
  currentStage: number | undefined,
  viewUt: number,
): DeltaVBudget {
  // Carried, not withheld: every arm that has a value gives one up. See this
  // file's header for why the alternative is the dangerous direction.
  const summary =
    summaryReading.state === "observed" ||
    summaryReading.state === "stale" ||
    summaryReading.state === "reckonable"
      ? summaryReading.value
      : undefined;
  const observedAtUt = observedAt(summaryReading);
  const stages: DeltaVStage[] = [];
  if (Array.isArray(stagesRaw)) {
    for (const raw of stagesRaw) {
      const row = normaliseStage(raw);
      if (row) stages.push(row);
    }
  }
  const activeStage =
    currentStage === undefined
      ? null
      : (stages.find((s) => s.stage === currentStage) ?? null);
  if (summary === undefined && stages.length === 0) {
    return summaryReading.state === "pending"
      ? NO_BUDGET
      : {
          ...NO_BUDGET,
          budget: {
            state: summaryReading.state,
            asOfUt: observedAtUt,
            ageSec: undefined,
            confirmedAbsent: summaryReading.state === "absent",
          },
        };
  }

  return {
    totalVac: totalOf(summary?.totalDvVac, "m/s"),
    totalAsl: totalOf(summary?.totalDvAsl, "m/s"),
    totalActual: totalOf(summary?.totalDvActual, "m/s"),
    totalBurnTime: totalOf(summary?.totalBurnTime, "s"),
    stageCount: totalOf(summary?.stageCount, "count"),
    stages,
    activeStage,
    budget: {
      state: summaryReading.state,
      asOfUt: observedAtUt,
      // Never negative: a sample can sit marginally ahead of the frame's view
      // time, and a negative age is not a thing to render.
      ageSec:
        observedAtUt === undefined
          ? undefined
          : Math.max(0, viewUt - observedAtUt.magnitude),
      confirmedAbsent: summaryReading.state === "absent",
    },
  };
}

/**
 * `core:delta-v-budget`. The owner-stamped Processor handle. Import it to
 * consume the budget, never re-declare it: a second registration under the same
 * id with a different compute throws (processors.ts).
 */
export const DELTA_V_BUDGET = CORE_UPLINK_CLIENT.registerProcessor({
  id: "delta-v-budget",
  deps: [
    // A READING for the summary, because the budget's currency IS part of the
    // answer: every verdict drawn from it (affordable, reachable, enough to land
    // on) has to know whether the number is now or was.
    { reading: "dv.summary" },
    "dv.stages",
    "vessel.structure",
  ] as const,
  compute: ([summaryReading, stagesRaw, structure], frame): DeltaVBudget =>
    deriveDeltaVBudget(
      summaryReading,
      stagesRaw,
      structure?.currentStage ?? undefined,
      frame.viewUt,
    ),
});
