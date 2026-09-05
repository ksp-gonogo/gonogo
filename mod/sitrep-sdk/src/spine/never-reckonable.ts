/**
 * Topics that do not carry a forward model, declared so the type system can drop
 * the modelled members from a read of them.
 *
 * **Two different reasons live in this one list, and they are kept in separate
 * named groups because they want opposite responses later.** "No model can
 * exist" is permanent and closed. "A model could exist and we are not paying for
 * it every frame" is an engineering decision and an invitation: make the model
 * cheaper and it moves out. Conflating them would lose that difference, and the
 * second group would rot into looking like the first.
 *
 * ## Why declaring this is sound when declaring the positive is not
 *
 * A static "this IS propagatable" is a lie waiting to happen: an orbit is
 * propagatable except during a burn or past an unmodelled SOI change, so the
 * class is a fact about the current MOMENT and an attribute cannot express it.
 * That is why there is no `[SitrepReckoning]` in the contract and why a
 * reading's `reckoning` is decided per frame by whether a model is on offer.
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
 * A list that merely RECORDS the default has no source construct to scan for,
 * so it rots without ever failing. This one is not that, because **it has the
 * compiler as a consumer**: a wrong entry surfaces the moment someone writes a
 * `reckoning === "available"` branch that then refuses to compile.
 *
 * A list nothing reads rots. A list the type checker reads cannot.
 *
 * What is NOT checked, deliberately, is the other direction. Nothing asserts
 * that every Topic appears here or is deliberately absent, and a total
 * classification would be the wrong guarantee to want: absence means "no model
 * has been written yet", which is the honest default and the state most topics
 * are permanently in. `never-reckonable.test.ts` therefore checks only that
 * every entry names a real Topic, that no entry also has a registered model,
 * that there are no duplicates, and that the runtime predicate agrees with the
 * list. Do not read "classified" into it: a topic missing from this list is not
 * an omission to be caught.
 *
 * ## Adding to it
 *
 * Add a topic here only when no model could ever exist for it, and say why in
 * the comment beside it. If the answer is "no model YET", leave it out: the
 * absence of a registered reckoner already reads `reckoning: "none"`, which is
 * the honest default, and putting it here would forbid the model someone is
 * about to write.
 */
export const NEVER_RECKONABLE = [
  // ── Unmodellable: no model can exist, permanently ──────────────────────────

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

  // ── Too expensive to model every frame ─────────────────────────────────────
  //
  // A model COULD exist for these and we have decided not to pay for it on the
  // frame path. This is the answer to cost, and it is a better one than making
  // the reckoning lazy: it is a declared, reviewable decision sitting beside
  // every other classification rather than a mechanism hidden in the type that
  // nobody reads. An Uplink that cannot pay declares its topic here and says
  // why, and making the model cheaper is what moves it back out.
  //
  // Deliberately EMPTY. Provider-supplied compute on the frame path is what this
  // whole pipeline already is (a mapper runs every tick, a derived channel and a
  // processor every frame), so a reckoning is not special and nothing here has
  // earned an exemption yet. An entry needs evidence of a real per-frame cost,
  // named in its comment.
] as const satisfies readonly string[];

/** A topic declared unmodellable. */
export type NeverReckonable = (typeof NEVER_RECKONABLE)[number];

const declared: ReadonlySet<string> = new Set(NEVER_RECKONABLE);

/** Whether `topic` is declared unmodellable. The runtime half of the type above. */
export function isNeverReckonable(topic: string): boolean {
  return declared.has(topic);
}
