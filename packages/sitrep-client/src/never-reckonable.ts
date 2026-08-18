import type { Reading } from "./reading";

/**
 * Topics that can never carry a forward model, declared so the type system can
 * drop the `reckonable` arm for them.
 *
 * ## Why declaring this is sound when declaring the positive is not
 *
 * A static "this IS propagatable" is a lie waiting to happen: an orbit is
 * propagatable except during a burn or past an unmodelled SOI change, so the
 * class is a fact about the current MOMENT and an attribute cannot express it.
 * That is why there is no `[SitrepReckoning]` in the contract and why the
 * `reckonable` arm's presence is decided per frame by whether a model is on
 * offer.
 *
 * The negative is the other way round. "This can never be reckoned" is a
 * permanent fact about the QUANTITY: an attitude has no model and never will, an
 * accident report is immutable, a discrete state the vessel changes on its own
 * has nothing to model. Declaring that costs nothing in honesty and buys a
 * caller the knowledge that a branch they might write can never be taken.
 *
 * Command-echo topics belong here too, which is a consistency check rather than
 * a special case: a commanded state is not a forward model of anything and lives
 * on its own expectation channel (`control-expectation.ts`), so as far as
 * `Reading` is concerned `vessel.control` has no model.
 *
 * ## Why a list here rather than a registry, and why it cannot rot
 *
 * This reverses an earlier recommendation of mine, deliberately. I argued
 * against recording class D per topic on the grounds that a list recording the
 * DEFAULT has no source construct to scan for and rots without failing. The
 * reasoning was right and the conclusion was wrong once the premise changed:
 * that list had no consumer, and **this one has the compiler**. A wrong entry
 * surfaces the moment someone writes a `reckonable` branch that used to
 * compile, and a missing one surfaces in `never-reckonable.test.ts`, which
 * asserts every Topic is classified.
 *
 * A list nothing reads rots. A list the type checker reads cannot.
 *
 * ## Adding to it
 *
 * Add a topic here only when no model could ever exist for it, and say why in
 * the comment beside it. If the answer is "no model YET", leave it out: the
 * absence of a registered reckoner already presents as `stale`, which is the
 * honest default, and putting it here would forbid the model someone is about
 * to write.
 */
export const NEVER_RECKONABLE = [
  // -- Attitude, and anything an autopilot moves on its own. `Navball` reached
  // this independently and is right: for an alignment reticle the honest
  // response to a non-observed reading is to draw something else.
  "vessel.attitude",

  // -- Command echo. Not a forward model at all: a commanded state lives on the
  // expectation channel, and folding it into a reading would put two clocks in
  // one type. See `control-expectation.ts`.
  "vessel.control",
  "time.warp",
  "robotics.servos",

  // -- Immutable records of something that already happened. Nothing left to
  // model, and advancing them would be inventing history.
  "crash.lastCrash",
  "recovery.lastSummary",
  "flight.started",
  "flight.ended",
  "flight.vesselChanged",

  // -- Configuration and catalogues. They change when the GAME changes, never
  // continuously, so a model has no dimension to move them along.
  "system.bodies",
  "time.calendar",
  "game.dlc",
  "spaceCenter.launchSites",
  "spaceCenter.partsAvailable",
  "robotics.available",
  "target.available",

  // -- Identity, roster and crew. A name does not propagate, and a crew list
  // changes by event rather than continuously.
  "vessel.identity",
  "vessel.crew",
  "commandCentre.roster",
  "spaceCenter.crewRoster",
  "spaceCenter.astronautComplex",

  // -- Scene and mode: discrete states the game switches, never quantities.
  "spaceCenter.scene",
  "vessel.physics.mode",
  "career.mode",
  "ksp.revertAvailability",
  "flight.current",

  // -- Structure. A vessel's parts and staging change by event (a decoupler, a
  // dock), so between events they are exact and across one no model would have
  // predicted it.
  "vessel.structure",
  "vessel.parts",

  // -- Ground-side bookkeeping about our own commands and links, which is
  // observed or it is nothing.
  "comms.controlState",
  "comms.connectivity",

  // -- Science records and archives: a catalogue of what has been collected,
  // advanced by an event rather than by a rate. `science.lab` is deliberately
  // NOT here: stored science against a science rate is a real class-B pairing.
  "science.archive",
  "science.experiments",
  "science.experimentBreakdown",
  "science.instruments",
  "science.sensors",
] as const satisfies readonly string[];

/** A topic declared unmodellable. */
export type NeverReckonable = (typeof NEVER_RECKONABLE)[number];

/**
 * A `Reading` with the `reckonable` arm removed.
 *
 * `stale` is still there and still has to be handled: that is where the
 * judgement lives, and this narrowing does not reduce it. What it removes is a
 * branch a caller could write for a case that cannot occur, and the wondering
 * about whether they had missed one.
 */
export type UnmodelledReading<T> = Exclude<Reading<T>, { state: "reckonable" }>;

const declared: ReadonlySet<string> = new Set(NEVER_RECKONABLE);

/** Whether `topic` is declared unmodellable. The runtime half of the type above. */
export function isNeverReckonable(topic: string): boolean {
  return declared.has(topic);
}
