// The rp1.* Topic registrations, both halves.
//
//   TYPE: a `declare module "@ksp-gonogo/sitrep-sdk"` augmentation adds each
//   Topic to `TopicPayloadMap`, so `useTelemetry("rp1.buildQueue")` resolves to
//   `Rp1BuildItemEntry[]` in any program that statically imports this module.
//
//   RUNTIME: `registerBarePrimitiveTopic` feeds the SDK's runtime registry, so
//   `isTopicId` and the replay recorder know these strings without the SDK ever
//   naming one, and `registerTopicUnits` feeds the decode-time unit lookup that
//   turns a bare number on the wire into the `Value<"bp">` the type promises.
//
// `rp1.available` is a bare JSON boolean with no payload type, so it never
// flows through codegen and is declared by hand here, same as every other
// Domain presence gate.
import {
  registerBarePrimitiveTopic,
  registerTopicUnits,
  registerTypeUnits,
  type TopicPayload,
} from "@ksp-gonogo/sitrep-sdk";
import type {
  Rp1BuildableCraftEntry,
  Rp1BuildItemEntry,
  Rp1CentreEntry,
  Rp1ComplexEntry,
  Rp1Confidence,
  Rp1ConstructionEntry,
  Rp1CrewEntry,
  Rp1CrewProgram,
  Rp1FundingCurveEntry,
  Rp1FundTarget,
  Rp1LcPricing,
  Rp1OperationEntry,
  Rp1PadEntry,
  Rp1Personnel,
  Rp1ProgramEntry,
  Rp1ProgramSlots,
  Rp1ResearchEntry,
  Rp1RushTerms,
  Rp1Tooling,
  Rp1TrainingCourseEntry,
  Rp1TrainingTemplateEntry,
  Rp1WarehouseItemEntry,
} from "./__generated__/contract";
import {
  GENERATED_TOPIC_SHAPES,
  GENERATED_TOPIC_UNITS,
  GENERATED_TYPE_SHAPES,
  GENERATED_TYPE_UNITS,
} from "./__generated__/units";
// Side-effect import, and load-bearing rather than tidiness: the unit maps
// below name `bp` and `confidence`, and `wrapTopicPayload` skips a field whose
// token has no model entry. Without this a widget imported on its own decodes
// those fields as bare numbers and renders them as absent, which is how a live
// Confidence price reached a test as a dash.
import "./units";

/** RP-1 is installed AND managing this save. Its value must match `Rp1ScUplink.AvailableTopic`. */
export const RP1_AVAILABLE_TOPIC = "rp1.available";

/** The space centres themselves, one row each. */
export const RP1_CENTRES_TOPIC = "rp1.centres";

/** Launch complexes: the layer stock and standalone KCT have no counterpart for. */
export const RP1_COMPLEXES_TOPIC = "rp1.complexes";

/** Vehicles being integrated, with a derived rate and ETA. */
export const RP1_BUILD_QUEUE_TOPIC = "rp1.buildQueue";

/** Finished vehicles: the honest "ready to launch" set under RP-1. */
export const RP1_WAREHOUSE_TOPIC = "rp1.warehouse";

/**
 * Every saved craft file, and what each launch complex would make of it: the
 * only way a widget can offer to START a build rather than repeat one.
 *
 * A PREVIEW. Its verdicts are measured from the craft file without loading it,
 * so two of RP-1's own conditions (human rating and stocked resources) are not
 * applied and an eligible complex is "nothing visible stops this" rather than a
 * promise. `rp1.build.start` asks RP-1 itself and is the authority.
 */
export const RP1_BUILDABLE_TOPIC = "rp1.buildable";

/** Launch pads, carrying the state that decides whether a launch will work. */
export const RP1_PADS_TOPIC = "rp1.pads";

/** Rollout, rollback, reconditioning and air-launch operations. */
export const RP1_OPERATIONS_TOPIC = "rp1.operations";

/**
 * What is being BUILT at a space centre, as opposed to integrated inside it:
 * facility upgrades, launch complexes and pads, one row shape discriminated by
 * `kind`. The half of the schedule that moves in months.
 */
export const RP1_CONSTRUCTIONS_TOPIC = "rp1.constructions";

/** The research queue, global across centres. */
export const RP1_RESEARCH_TOPIC = "rp1.research";

/** Who is on the payroll. */
export const RP1_PERSONNEL_TOPIC = "rp1.personnel";

/**
 * What rushing a launch complex costs, career-wide, so the price is readable at
 * the moment nothing is rushing and the decision is being made.
 */
export const RP1_RUSH_TERMS_TOPIC = "rp1.rushTerms";

/**
 * What BUILDING a complex costs, for a form pricing one that does not exist yet.
 *
 * Carries the half of RP-1's price a client cannot compute: one funds-per-unit
 * figure per offerable resource, which is exact rather than approximate because
 * RP-1's own expression is linear in the amount. The pad and integration halves
 * are a closed form over what the operator typed and are computed client-side;
 * see `lcCost.ts`.
 */
export const RP1_LC_PRICING_TOPIC = "rp1.lcPricing";

/** RP-1's own currency, absent rather than zero when the module is not live. */
export const RP1_CONFIDENCE_TOPIC = "rp1.confidence";

/**
 * Every Program RP-1 knows about, running, finished or on offer, discriminated
 * by `state`. Absent rather than empty when RP-1's handler is not live: its
 * catalogue is never empty, so an empty list would be a claim about the career.
 */
export const RP1_PROGRAMS_TOPIC = "rp1.programs";

/** How much Program capacity the Administration building allows, and how much is committed. */
export const RP1_PROGRAM_SLOTS_TOPIC = "rp1.programSlots";

/**
 * RP-1's whole funding-curve table, which is what turns a Program's curve NAME
 * into a shape. A career-wide catalogue of twelve Hermite curves rather than a
 * per-Program field: thirty-seven Programs share them, and repeating twelve
 * keys on every row would be the same table thirty-seven times.
 *
 * <para>Absent rather than empty when RP-1's handler is not live, for the same
 * reason `rp1.programs` is: RP-1 ships twelve curves and pays every Program on
 * one of them, so an empty table could only be a claim that it pays on none.</para>
 */
export const RP1_PROGRAM_FUNDING_CURVES_TOPIC = "rp1.programFundingCurves";

/**
 * Each kerbal RP-1 schedules: when their career ends, what they are training on,
 * and what training is about to lapse. Joined to `spaceCenter.crewRoster` by
 * name. Absent rather than empty when RP-1's CrewHandler is not live, because an
 * empty list would say RP-1 is scheduling nobody.
 *
 * Deliberately carries no standing: whether a kerbal is RETIRED rides the stock
 * roster's own `standing` field through the crewStanding capability, so a widget
 * that has never heard of RP-1 does not report a retiree as a fatality.
 */
export const RP1_CREW_TOPIC = "rp1.crew";

/** The career-wide rules the crew schedule runs under: retirement and R&R switches, training rates, the extension cap. */
export const RP1_CREW_PROGRAM_TOPIC = "rp1.crewProgram";

/**
 * The balance a warp is running toward, and how far off it is. A warp STOP
 * CONDITION rather than a transaction, and it persists past the warp it stopped,
 * so an operator who cannot see it reads the next unexplained halt as the game
 * misbehaving. `active: false` is a real answer meaning none is set; the whole
 * payload is absent when RP-1's space centre could not be read.
 */
export const RP1_FUND_TARGET_TOPIC = "rp1.fundTarget";

/**
 * The training courses RP-1 currently holds, course-level.
 *
 * Beside the per-kerbal training fields on `rp1.crew` rather than instead of
 * them: a course with nobody enrolled has no kerbal row to group, and the seat
 * bounds live on the course. Those bounds decide the control an operator is
 * offered, Cancel for the whole course or Remove for one student.
 */
export const RP1_TRAINING_TOPIC = "rp1.training";

/**
 * The trainings RP-1 could be asked to run: the enrolable side of
 * `rp1.training`.
 *
 * One row per crewed part in the install, whether or not anyone ever trains on
 * it, carrying what an operator picks by: the seat bounds, the base time and
 * whether the career has unlocked it.
 *
 * There is deliberately no Astronaut Complex requirement on these rows. RP-1
 * states it through a getter that mutates a shared static, which a per-tick read
 * must not do, so `rp1.training.enrol` asks it at the moment of the press and a
 * refusal names the tier.
 */
export const RP1_TRAINING_CATALOGUE_TOPIC = "rp1.trainingCatalogue";

/**
 * What tooling the vehicle on the editor's table needs, and what it costs not to
 * have it.
 *
 * The only channel on this Uplink whose subject is the ship being DESIGNED rather
 * than the space centre, so it answers nothing from anywhere else.
 *
 * Two money numbers, and they are different questions. `toolAllCost` is RP-1's own
 * deduplicated price for tooling the whole vehicle and is NOT the sum of the rows:
 * a tooling covers anything of its type within four per cent, so paying for one
 * part can leave a neighbour free. Each row's `untooledSurcharge` is what NOT
 * tooling costs, per build, for ever, which is the number the decision turns on.
 *
 * Absence is a real answer and is not "everything is tooled": no ship in the
 * editor, or RP-1's tooling switched off, in which case its own level lookup would
 * have reported a finished vehicle.
 */
export const RP1_TOOLING_TOPIC = "rp1.tooling";

declare module "@ksp-gonogo/sitrep-sdk" {
  interface TopicPayloadMap {
    "rp1.available": boolean;
    "rp1.centres": Rp1CentreEntry[];
    "rp1.complexes": Rp1ComplexEntry[];
    "rp1.buildQueue": Rp1BuildItemEntry[];
    "rp1.warehouse": Rp1WarehouseItemEntry[];
    "rp1.buildable": Rp1BuildableCraftEntry[];
    "rp1.pads": Rp1PadEntry[];
    "rp1.operations": Rp1OperationEntry[];
    "rp1.constructions": Rp1ConstructionEntry[];
    "rp1.research": Rp1ResearchEntry[];
    "rp1.personnel": Rp1Personnel;
    "rp1.rushTerms": Rp1RushTerms;
    "rp1.lcPricing": Rp1LcPricing;
    "rp1.confidence": Rp1Confidence;
    "rp1.programs": Rp1ProgramEntry[];
    "rp1.programSlots": Rp1ProgramSlots;
    "rp1.programFundingCurves": Rp1FundingCurveEntry[];
    "rp1.crew": Rp1CrewEntry[];
    "rp1.crewProgram": Rp1CrewProgram;
    "rp1.fundTarget": Rp1FundTarget;
    "rp1.training": Rp1TrainingCourseEntry[];
    "rp1.trainingCatalogue": Rp1TrainingTemplateEntry[];
    "rp1.tooling": Rp1Tooling;
  }
}

registerBarePrimitiveTopic(RP1_AVAILABLE_TOPIC);
registerBarePrimitiveTopic(RP1_CENTRES_TOPIC);
registerBarePrimitiveTopic(RP1_COMPLEXES_TOPIC);
registerBarePrimitiveTopic(RP1_BUILD_QUEUE_TOPIC);
registerBarePrimitiveTopic(RP1_WAREHOUSE_TOPIC);
registerBarePrimitiveTopic(RP1_BUILDABLE_TOPIC);
registerBarePrimitiveTopic(RP1_PADS_TOPIC);
registerBarePrimitiveTopic(RP1_OPERATIONS_TOPIC);
registerBarePrimitiveTopic(RP1_CONSTRUCTIONS_TOPIC);
registerBarePrimitiveTopic(RP1_RESEARCH_TOPIC);
registerBarePrimitiveTopic(RP1_PERSONNEL_TOPIC);
registerBarePrimitiveTopic(RP1_RUSH_TERMS_TOPIC);
registerBarePrimitiveTopic(RP1_CONFIDENCE_TOPIC);
registerBarePrimitiveTopic(RP1_PROGRAMS_TOPIC);
registerBarePrimitiveTopic(RP1_PROGRAM_SLOTS_TOPIC);
registerBarePrimitiveTopic(RP1_PROGRAM_FUNDING_CURVES_TOPIC);
registerBarePrimitiveTopic(RP1_CREW_TOPIC);
registerBarePrimitiveTopic(RP1_CREW_PROGRAM_TOPIC);
registerBarePrimitiveTopic(RP1_FUND_TARGET_TOPIC);
registerBarePrimitiveTopic(RP1_TRAINING_TOPIC);
registerBarePrimitiveTopic(RP1_TRAINING_CATALOGUE_TOPIC);
registerBarePrimitiveTopic(RP1_TOOLING_TOPIC);

// Driven by looping the generated maps rather than naming each entry, so a
// Topic added to this Uplink's contract later needs no new call site. Both
// registries: the topic-keyed one covers a payload's own fields, and the
// type-keyed one is what a nested shape resolves through.
for (const [topic, units] of Object.entries(GENERATED_TOPIC_UNITS)) {
  registerTopicUnits(topic, units, GENERATED_TOPIC_SHAPES[topic] ?? {});
}
for (const [typeName, units] of Object.entries(GENERATED_TYPE_UNITS)) {
  registerTypeUnits(typeName, units, GENERATED_TYPE_SHAPES[typeName] ?? {});
}

/**
 * A compile-time invariant checked by `pnpm build` and `pnpm typecheck`: it
 * proves the augmentation above is in-program and resolves each Topic to its
 * real payload type rather than the `unknown` a missing augmentation leaves
 * behind. The per-Uplink half of the SDK's own assertion, devolved here because
 * the SDK cannot see this augmenting module.
 */
type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
    ? true
    : false;
type Expect<T extends true> = T;
export type _ResolvesRp1Available = Expect<
  Equal<TopicPayload<"rp1.available">, boolean>
>;
export type _ResolvesRp1Centres = Expect<
  Equal<TopicPayload<"rp1.centres">, Rp1CentreEntry[]>
>;
export type _ResolvesRp1Complexes = Expect<
  Equal<TopicPayload<"rp1.complexes">, Rp1ComplexEntry[]>
>;
export type _ResolvesRp1BuildQueue = Expect<
  Equal<TopicPayload<"rp1.buildQueue">, Rp1BuildItemEntry[]>
>;
export type _ResolvesRp1Warehouse = Expect<
  Equal<TopicPayload<"rp1.warehouse">, Rp1WarehouseItemEntry[]>
>;
export type _ResolvesRp1Buildable = Expect<
  Equal<TopicPayload<"rp1.buildable">, Rp1BuildableCraftEntry[]>
>;
export type _ResolvesRp1Pads = Expect<
  Equal<TopicPayload<"rp1.pads">, Rp1PadEntry[]>
>;
export type _ResolvesRp1Operations = Expect<
  Equal<TopicPayload<"rp1.operations">, Rp1OperationEntry[]>
>;
export type _ResolvesRp1Constructions = Expect<
  Equal<TopicPayload<"rp1.constructions">, Rp1ConstructionEntry[]>
>;
export type _ResolvesRp1Research = Expect<
  Equal<TopicPayload<"rp1.research">, Rp1ResearchEntry[]>
>;
export type _ResolvesRp1Personnel = Expect<
  Equal<TopicPayload<"rp1.personnel">, Rp1Personnel>
>;
export type _ResolvesRp1RushTerms = Expect<
  Equal<TopicPayload<"rp1.rushTerms">, Rp1RushTerms>
>;
export type _ResolvesRp1LcPricing = Expect<
  Equal<TopicPayload<"rp1.lcPricing">, Rp1LcPricing>
>;
export type _ResolvesRp1Confidence = Expect<
  Equal<TopicPayload<"rp1.confidence">, Rp1Confidence>
>;
export type _ResolvesRp1Programs = Expect<
  Equal<TopicPayload<"rp1.programs">, Rp1ProgramEntry[]>
>;
export type _ResolvesRp1ProgramSlots = Expect<
  Equal<TopicPayload<"rp1.programSlots">, Rp1ProgramSlots>
>;
export type _ResolvesRp1ProgramFundingCurves = Expect<
  Equal<TopicPayload<"rp1.programFundingCurves">, Rp1FundingCurveEntry[]>
>;
export type _ResolvesRp1Crew = Expect<
  Equal<TopicPayload<"rp1.crew">, Rp1CrewEntry[]>
>;
export type _ResolvesRp1CrewProgram = Expect<
  Equal<TopicPayload<"rp1.crewProgram">, Rp1CrewProgram>
>;
export type _ResolvesRp1FundTarget = Expect<
  Equal<TopicPayload<"rp1.fundTarget">, Rp1FundTarget>
>;
export type _ResolvesRp1Training = Expect<
  Equal<TopicPayload<"rp1.training">, Rp1TrainingCourseEntry[]>
>;
export type _ResolvesRp1TrainingCatalogue = Expect<
  Equal<TopicPayload<"rp1.trainingCatalogue">, Rp1TrainingTemplateEntry[]>
>;
export type _ResolvesRp1Tooling = Expect<
  Equal<TopicPayload<"rp1.tooling">, Rp1Tooling>
>;
