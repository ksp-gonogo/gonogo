import type { TimelinePoint } from "./timeline";
import type { Value } from "./unit-system/value";

/**
 * What a telemetry read answers with, and how a widget may use it.
 *
 * This lives in the SDK rather than app-side because the Uplink devkit's
 * `useTelemetry` answers with a `Reading`, and the SDK sits below
 * `@ksp-gonogo/sitrep-client` in the dependency graph: the client depends on the
 * SDK, never the reverse. Exactly one bundled Uplink imports only through the
 * surface a third party actually has (this SDK plus ui-kit), and it is the one that
 * broke when this file's signature lied: an Uplink that also reaches app-internal
 * packages cannot feel a lie in this layer. That client is the canary for the devkit
 * contract.
 *
 * Everything here is consumer-side and total over the union: the type, its
 * reckoning types, the accessors, declining a reckoning, and measuring an age. A
 * third-party author needs all of it to USE a reading. What stays in the client is
 * the producer half, which needs the timeline and the store: minting a reading from
 * a stored point, and the reckoner registry.
 */

/**
 * Which model produced a reckoning.
 *
 * A closed union rather than a string, so adding a basis is a DECLARATION
 * rather than a spelling. An operator calibrates their trust in a propagated
 * number against what produced it, and a free-form string lets two providers
 * describe the same model differently (or misdescribe it) with nothing to
 * notice. Add a member here, with a line saying what it assumes and therefore
 * where it stops being true.
 *
 * - `kepler-propagation`: a two-body propagation of an orbital state. Honest
 *   for as long as the conic holds, which is until a burn, an SOI change or a
 *   perturbation the propagator does not model
 * - `linear-dead-reckoning`: position advanced by its last observed velocity.
 *   First-order only, so it is honest for seconds where the true motion is
 *   curved (any orbiting pair) and longer where it is not
 * - `rate-integration`: a quantity advanced by its last observed rate of
 *   change. Honest while the rate holds, which for a consumable means until
 *   something switches a converter, a light or a crew member
 */
export type ReckoningBasis =
  | "kepler-propagation"
  | "linear-dead-reckoning"
  | "rate-integration";

/**
 * A forward-modelled value: what a provider's model says the quantity is NOW,
 * given the last real observation and however long ago it was.
 *
 * `atUt` is the UT the reckoning is FOR, not the UT the observation behind it
 * was made at (`Reading`'s `asOfUt` carries that). Both are needed: an operator
 * reads a modelled figure against how far it has been carried.
 */
export interface Reckoning<T> {
  value: T;
  atUt: Value<"ut">;
  basis: ReckoningBasis;
  /**
   * Which paths inside `value` the model actually MOVED, dotted from the
   * payload root. Everything not named here is a verbatim copy of the last
   * observation, carried along because `value` is the whole payload.
   *
   * It exists because a payload is not one reckoning class. `vessel.target`
   * flattens to forty-seven field paths: relative geometry that propagates,
   * identity fields only a command changes, two absolute UTs, and metadata.
   * A model that dead-reckons the relative position and copies the rest would
   * otherwise stamp `basis: "linear-dead-reckoning"` on the vessel's NAME,
   * which is a modelled label over a stale observation: the failure this type
   * exists to prevent, committed by the mechanism meant to prevent it.
   *
   * `basis` above stays, and is the basis of the entry covering the root. A
   * whole-topic read only reaches `reckoning: "available"` when the model covers
   * the root (see `TopicModel`), so it is always well defined on a reckoning a
   * caller can hold.
   */
  modelled: readonly ModelledField[];
}

/** One path a model moved, and what moved it. See {@link Reckoning.modelled}. */
export interface ModelledField {
  /** Dotted from the payload root. `""` is the whole payload. */
  readonly path: string;
  readonly basis: ReckoningBasis;
}

/**
 * What a reckoner offers: the coverage it claims, and the pull that produces
 * the modelled payload.
 *
 * Coverage sits OUTSIDE the thunk because the store has to know what a model
 * answers for before deciding which arm to build, and running the model to
 * find out would defeat the pull. A model that does not cover the payload root
 * cannot answer for a whole-topic read, so that read stays `stale`.
 *
 * `R` is what the pull ANSWERS WITH, and it defaults to the whole payload
 * because that is what a whole-topic model produces. A model declared per VALUE
 * answers with the projection of the fields it moves instead, so `R` is
 * `Pick<T, K>` there. Two parameters rather than one because the coverage claim
 * is still about paths on `T` whichever shape the answer takes.
 */
export interface TopicModel<T, R = T> {
  /** Paths this model moves. Empty claims nothing and is never offered. */
  readonly modelled: readonly ModelledField[];
  /** Run the model for `viewUt`. Pure: same inputs, same answer. */
  reckon(viewUt: number): R;
}

/**
 * Why a model could not answer for this frame, on a topic whose contract
 * DECLARES a value reckonable.
 *
 * On a plain {@link Reading}, `reckoning: "none"` is the honest majority answer
 * and needs no explanation: most topics have no model and never will. On a
 * declared value it is a specific refusal, because the declaration is a promise
 * that the wire carries the model's inputs, so the only ways to reach `"none"`
 * are that an input did not arrive, that the model was asked past where it holds,
 * or that the model does not apply to this frame at all. A refusal a widget can
 * render ("no conic past the SOI transition") beats a silent absence, which is
 * why it is REQUIRED on the value-bearing `"none"` arms rather than optional.
 *
 * It sits on the arm and NOT inside `reckoned`, which is the rule
 * {@link Reading}'s own doc states under "No horizon field": a caller holding a
 * reckoning must never discover at call time that the capability has gone bad.
 * A model still withdraws by not being offered on the next frame. All that has
 * changed is that a declared value says WHY it withdrew.
 *
 * `input` names the declared input that was missing or that ruled the model out,
 * spelled exactly as the contract declares it (`relativeVelocity`,
 * `@vessel.orbit`, `@vessel.orbit#mu`), so the string a widget shows and the
 * string the contract carries are the same string.
 */
export interface ReckoningDecline {
  readonly reason:
    | "input-absent"
    | "beyond-horizon"
    | "model-inapplicable"
    | "contested";
  /** The declared input responsible, where the reason has one. */
  readonly input?: string;
  /** One sentence for an operator. Never a stack, never a code. */
  readonly note?: string;
}

/**
 * What a reckoner answers: a model, or a refusal that says which input failed
 * it.
 *
 * `undefined` used to be the whole of "no", and it could not distinguish an
 * input that never arrived from a horizon that had been passed. A caller cannot
 * tell those apart from the outside, and they are the two things an operator
 * most wants said.
 *
 * `R` is the projection the model produces, which for a declared value is
 * `Pick<T, K>` rather than the whole payload. See {@link ReckonableReading}.
 */
export type ReckonerAnswer<T, R = T> =
  | TopicModel<T, R>
  | { readonly declined: ReckoningDecline };

/**
 * One topic's value AND its currency, as a single thing the compiler will not
 * let a widget read incuriously.
 *
 * A widget that renders stale data as though it were live is this project's
 * most consequential failure mode. The weaker version of this fix already
 * exists and did not work: `StreamStatusValue` rides its own channel beside the
 * value, ui-kit renders it (`StreamStatusBadge`), and the dashboard even
 * derives a per-widget summary from `dataRequirements` and badges the panel
 * header with it. It was adopted by
 * zero of the thirty-nine widgets that read telemetry, because a badge beside a
 * body is chrome, and nothing forces the body to consult it.
 *
 * So there is no arm you can read a value off without first writing the
 * discriminant, and every distinction that changes what you DRAW is an arm
 * rather than a field. Reaching a value means branching, and the branch is
 * where the caveat gets rendered. Same spirit as `Value<"s">` making
 * unit-blindness unrepresentable.
 *
 * ## Delay is not staleness
 *
 * Under a light-time delay every value is old. If that counted as stale the
 * discriminant would read `stale` everywhere and carry no information at all.
 * A value 4 s old under a 4 s light-time is as current as physics permits, and
 * that is `observed`. Stale means we have MISSED updates we should have had,
 * which is what `HeartbeatTracker` infers from keyframe cadence and never from
 * `validAt` age (see its own doc). Reckoning is therefore only needed for
 * genuine loss of contact, not for the delay case.
 *
 * ## The arms
 *
 * - `pending`: nothing at-or-before the frame's view time yet, a cold topic or
 *   a resync after a rewind. Names the never-arrived case that `undefined`
 *   currently conflates with went-stale
 * - `unowned`: nothing will EVER publish this topic. No installed Uplink
 *   declares it and it falls under no dynamic namespace, so waiting is futile.
 *   See "Why `unowned` is not `pending`" below for the whole point of it
 * - `absent`: a confirmed tombstone, the subject says there is no value.
 *   Carries `atUt` because "confirmed nothing, as of when" is the honest
 *   statement: a tombstone can itself go old, and nothing before this could say
 *   so. It is what lets a widget report "no target set, confirmed 3 s ago"
 *   instead of asserting it for the rest of the mission
 * - `observed`: the newest sample that could have reached us
 * - `stale`: we have missed updates. `value` is the last REAL observation,
 *   always reachable, and `asOfUt` says when it was made
 *
 * ## The second discriminant: `reckoning`
 *
 * Whether a forward model is on offer is a SEPARATE axis, carried on its own
 * required field rather than folded into `state`:
 *
 * - `reckoning: "none"`: no model is on offer this frame. The honest majority
 * - `reckoning: "available"`: a model is on offer, and `reckoned` carries what
 *   it says the quantity is at the frame's view time
 *
 * Every arm carries the field, `pending`, `unowned` and `absent` included, where
 * it is permanently `"none"`: nothing has been observed (or the subject has said
 * there is nothing), so there is nothing to carry forward. Carrying it on every
 * arm is what makes the axes independent, because a caller can ask
 * `reading.reckoning === "available"` without first narrowing `state`.
 *
 * ## Why `unowned` is not `pending`
 *
 * A widget subscribing to a topic nothing will ever publish sat on
 * `{state: "pending"}` for the rest of the session, which reads identically to
 * "the mod has not sent this yet". An author whose widget rendered blank had
 * nothing to go on: no log line, no banner, no health row, and the two cases
 * want opposite next moves. Waiting is right for one and futile for the other.
 *
 * The distinction is decided by the mod, not inferred client-side.
 * `ProcessSubscribe` answers a subscribe for a declared channel (or one under a
 * registered dynamic namespace) with an `EventMsg { name: "subscribed" }`, and
 * answers a subscribe for anything else with a bare return: no error, no ack,
 * nothing. So "we sent a subscribe and no ack came back inside a bounded
 * window" is the authority's own answer rather than a reconstruction of it, and
 * it gets a fail-softed Uplink right for free, where a rule built on the
 * roster's owned-prefix lists would have called four engine built-ins unowned.
 *
 * ## `unowned` is a POSITIVE finding, and silence is not one
 *
 * The rule that keeps this arm honest: reach it only on evidence that the
 * subscribe was answered with nothing, never on the mere absence of data.
 * "Cannot decide" is a third answer and it spells `pending`.
 *
 * Undecided, and therefore `pending`:
 *
 * - the bounded window has not elapsed yet
 * - the transport is not connected, so no subscribe has been answered either way
 * - the read is happening on a STATION. A station's subscribe reaches the mod
 *   only when the host's own refcount makes a 0 -> 1 transition, so a topic the
 *   host already holds is never re-acked and a station would see silence for a
 *   perfectly well owned topic. A station therefore does not decide this arm
 * - the mod predates the ack, so no topic would ever be acked
 *
 * A false `unowned` tells an author their correct code is broken, which is
 * worse than the silence this arm removes. Every widening of what may reach
 * this arm has to be argued against that sentence.
 *
 * ## It carries nothing, and that is deliberate
 *
 * There is no value (there never was one and there never will be), and no
 * instant (nothing was observed, so `observedAt` answers `undefined` exactly as
 * it does for `pending`). The topic id a diagnostic wants is the argument the
 * caller already passed to `useTelemetry`, so putting it on the arm would
 * duplicate a fact the call site holds and admit the possibility of the two
 * disagreeing.
 *
 * ## Why `reckoning` is a discriminant and `grade` is a plain field
 *
 * One rule, applied twice: compiler pressure is worth paying where it forces a
 * DIFFERENT branch, and worth trading away where it would force several
 * identical ones.
 *
 * `grade` does not change what you draw, it labels the same render, so four
 * arms would be four copy-pasted bodies drifting apart across thirty-nine
 * widgets. Plain field.
 *
 * A reckoning DOES change what you draw: a propagated position is a different
 * marker in a different place from a last-known position. An OPTIONAL `reckoned`
 * field was the first shape tried here and it was wrong, because an optional
 * field is one a destructuring consumer ignores by default and ignoring it
 * compiles: `reading.reckoned` typechecks everywhere and answers `undefined`, so
 * a reckoning that EXISTS could be silently dropped while the widget still
 * looked right. That is precisely the failure this type is built to prevent, and
 * it is still not the shape here.
 *
 * `reckoned` is a REQUIRED field of a union member selected by a REQUIRED
 * discriminant. `reading.reckoned` does not compile until `reading.reckoning ===
 * "available"` has been written, because on the other member the property does
 * not exist at all. That is the same compiler pressure the old `reckonable` arm
 * applied, and it is what "forces a branch" means here: reaching a reckoning
 * costs a written test, exactly as reaching a value costs one.
 *
 * ## Why it is a SECOND discriminant rather than an arm of the first
 *
 * `reckonable` used to be an arm of `state`, which made reckonability a SUBTYPE
 * OF STALE and left live-and-reckonable unrepresentable. It is not: the two are
 * orthogonal. A model is a medium for expressing prediction, and a quantity
 * whose cause is known (a conic, a rate) is forward-modellable whether or not
 * the last packet arrived on time. The only real connection is behavioural: a
 * widget is most likely to REACH for a modelled figure once its live one has
 * gone stale.
 *
 * Riding the staleness discriminant made two readings of one fact disagree in
 * one frame. `vessel.state` is derived from `vessel.orbit` and forward-solves
 * from the same elements; it read `reckonable` while `vessel.orbit` read `stale`,
 * because the only way to say "a model exists" was to also say "we have missed
 * updates". Splitting the axis lets both say what is true of them.
 *
 * A widget may still legitimately decline to propagate (a scalar readout may
 * only want a number and a staleness caption). That has to be a WRITTEN choice:
 * see `withoutReckoning`.
 *
 * ## No horizon field, and no way to over-extrapolate
 *
 * Nothing here says how far a reckoning may be trusted, and `reckoned` is never
 * absent on a reading that carries it. Both fall out of the reading being
 * rebuilt every frame: once the provider's horizon is exceeded it stops offering
 * a model, and the topic simply reads `reckoning: "none"` from that frame on,
 * keeping whatever `state` it honestly has. So `reckoning: "available"` IS the
 * statement of trust, structurally rather than by convention, and there is no
 * horizon for a caller to compare against and reckon anyway.
 *
 * **Do not make `reckoned` able to answer "unavailable".** `reckoning: "none"`
 * already says it, at the only moment it can be said honestly. A failure return
 * would mean a caller could hold a capability that has since gone bad and
 * discover it at call time, which puts an error path in thirty-nine widgets to
 * represent something the discriminant already carries. If a model needs to
 * withdraw, it withdraws by not being offered on the next frame.
 *
 * ## The three-channel rule, and why this is its exception
 *
 * `stream-status.ts` and `use-certainty.ts` both state the repo rule: value,
 * staleness/absence, and certainty are three independent channels a widget
 * composes, never nested inside one another. This nests value inside
 * staleness, on the evidence above.
 *
 * The exception is for the value/staleness pair ONLY. `Certainty` stays on its
 * own channel and must not be folded in: it is a property of the FRAME's
 * `viewUt`, not of any one topic, so every topic read in one frame shares it.
 * Nesting it here would duplicate one fact across every read in a frame and
 * admit the possibility of two of them disagreeing, which is exactly what the
 * single-view-time invariant and `FrameToken` exist to prevent.
 */
export type Reading<T> =
  | { state: "pending"; reckoning: "none" }
  | { state: "unowned"; reckoning: "none" }
  | { state: "absent"; reckoning: "none"; atUt: Value<"ut"> }
  | {
      state: "observed";
      reckoning: "none";
      value: T;
      atUt: Value<"ut">;
    }
  | {
      state: "observed";
      reckoning: "available";
      /** The observation itself. Never a modelled value; see `reckoned`. */
      value: T;
      atUt: Value<"ut">;
      reckoned: Reckoning<T>;
    }
  | {
      state: "stale";
      reckoning: "none";
      /** The last REAL observation. Never a modelled value. */
      value: T;
      /** The UT that observation was made at. */
      asOfUt: Value<"ut">;
      grade: StaleGrade;
    }
  | {
      state: "stale";
      reckoning: "available";
      /** The last REAL observation, exactly as on the unmodelled member. */
      value: T;
      asOfUt: Value<"ut">;
      grade: StaleGrade;
      /**
       * The forward-modelled value for this frame's view time, computed when the
       * reading is built.
       *
       * A PLAIN FIELD, and the reasoning is worth keeping because it went the
       * other way twice first. Laziness was justified as "a reckoner is
       * provider-supplied, so its cost is not ours to assume". The same is true
       * of everything else in this system: an Uplink's mapper runs every tick,
       * its derived channel's `derive` runs every frame, its processor's
       * `compute` runs every frame, and class B's projection IS a derived
       * channel. Provider-supplied compute on the frame path is what this whole
       * pipeline is, so reckoning being the single exception was an
       * inconsistency rather than a principle. A mechanism that defends against
       * its own providers is one that expects to be rare, and this one is meant
       * to be universal.
       *
       * Cost is answered by DECLARATION instead: a topic whose model is too
       * expensive to run per frame goes in `NEVER_RECKONABLE`'s
       * too-expensive group, which is a reviewable engineering decision in the
       * same list as every other classification rather than a mechanism hidden
       * in the type.
       *
       * Being a field rather than a getter also removes a whole failure mode
       * instead of defending against it: a getter is lost by a spread, and lost
       * SILENTLY, because the spread evaluates it and freezes one frame's answer
       * as a permanent plain value. A field survives a copy.
       *
       * Fresh per frame either way, which is what the identity contract needs: a
       * reckoning is a function of the view time, so a reading that kept its
       * identity while `viewUt` advanced would answer for a moment that had
       * passed, and a model could never withdraw at its horizon. The store
       * re-derives a reading (and only a reading whose topic has a model on
       * offer) when the frame's view time moves; an unmodelled topic keeps the
       * frozen identity that stops every widget re-rendering at frame cadence.
       * See `TimelineStore.sampleReading`.
       */
      reckoned: Reckoning<T>;
    };

/**
 * One RECKONABLE topic's value AND its currency, where `T` is the payload and
 * `K` the fields the contract declares a model can carry forward.
 *
 * It is {@link Reading}'s arms with two differences and only two: `reckoned` is
 * the PROJECTION rather than the payload, and the value-bearing `"none"` arms
 * carry a required {@link ReckoningDecline}. Everything `Reading`'s doc says
 * about the states, about the two axes being orthogonal, and about reaching a
 * value costing a written branch is true here unchanged, and is not restated.
 *
 * ## `reckoned` is the projection, because a payload is not one reckoning class
 *
 * Reckonability is declared PER VALUE. `vessel.flight` carries an altitude a
 * conic advances beside a `situation` the game switches, and a model that
 * propagates the first and copies the second would otherwise hand a caller a
 * whole payload labelled "modelled". {@link Reckoning.modelled} says which paths
 * moved, and it says so at runtime, in a field nothing forces a caller to read.
 * `Reckoning<Pick<T, K>>` says the same thing to the COMPILER: reading a field
 * no model moves off `reckoned` does not typecheck, so the mistake cannot be
 * made rather than merely being documented.
 *
 * ## Why a value-bearing arm always says something about the model
 *
 * A declared value always has a model on offer: core ships the vanilla, an
 * Uplink may elect a better one, and the declaration is a promise that the wire
 * carries that model's inputs. So on the arms that carry a value there is no
 * such thing as nothing-to-say. Either `reckoned` is there, or `declined` is
 * there naming what stopped it. That pairing is what "unconditional" buys: not
 * that `reckoned` appears on every arm regardless (it cannot, because a model
 * genuinely does withdraw at an SOI transition, at the atmosphere interface and
 * past its stated horizon), but that a caller who has narrowed to a value can
 * never fall through to a branch where the type declines to comment.
 *
 * The discriminant therefore survives on this type, which is the part worth
 * stating because it looks at first like a regression. What actually goes away
 * is the discriminant on every UNMARKED topic, where it was carrying no
 * information at all.
 *
 * ## A decline is a value-level absence inside a type-level presence
 *
 * The declaration is a statement about the CONTRACT: these inputs are published,
 * so this value can be carried forward. It is static, and it is a property of
 * the wire rather than of any one frame. Whether a model can answer for THIS
 * frame is a different question, answered by the data: the input may not have
 * arrived, the view time may be past where the conic holds, the model may not
 * apply to a vessel on rails at all.
 *
 * So the type says the capability exists and the value says whether it fired,
 * and neither can stand in for the other. Folding the decline into the type (an
 * optional `reckoned`) would lose the reason and re-admit the silent drop that
 * {@link Reading} exists to prevent; folding the capability into the value (a
 * runtime "is this topic reckonable" flag) is pass one, and it is what this
 * type replaces.
 *
 * ## Deliberately NOT assignable to `Reading<T>`
 *
 * `Reckoning<Pick<T, K>>` is not a `Reckoning<T>`, so handing one of these to
 * something typed `Reading<T>` fails to compile. That is the point: the callee
 * would be entitled to read the whole payload off the model. The observed
 * payload overlaid by the modelled fields is
 * `{ ...reading.value, ...reading.reckoned.value }`, written at the call site
 * rather than hidden in a helper, because that spread IS the judgement and it
 * should be visible in review.
 */
export type ReckonableReading<T, K extends keyof T> =
  | { state: "pending"; reckoning: "none" }
  | { state: "unowned"; reckoning: "none" }
  | { state: "absent"; reckoning: "none"; atUt: Value<"ut"> }
  | {
      state: "observed";
      reckoning: "none";
      value: T;
      atUt: Value<"ut">;
      /** Why the declared model did not answer for this frame. */
      declined: ReckoningDecline;
    }
  | {
      state: "observed";
      reckoning: "available";
      /** The observation itself. Never a modelled value; see `reckoned`. */
      value: T;
      atUt: Value<"ut">;
      /** The declared fields, carried forward to this frame's view time. */
      reckoned: Reckoning<Pick<T, K>>;
    }
  | {
      state: "stale";
      reckoning: "none";
      /** The last REAL observation. Never a modelled value. */
      value: T;
      /** The UT that observation was made at. */
      asOfUt: Value<"ut">;
      grade: StaleGrade;
      declined: ReckoningDecline;
    }
  | {
      state: "stale";
      reckoning: "available";
      /** The last REAL observation, exactly as on the unmodelled member. */
      value: T;
      asOfUt: Value<"ut">;
      grade: StaleGrade;
      reckoned: Reckoning<Pick<T, K>>;
    };

/**
 * Which kind of missed-update a stale reading is. A FIELD rather than more arms:
 * see `Reading`'s own doc for the rule.
 *
 * - `held-stale`: this ONE channel's keyframes stopped arriving on cadence, or
 *   the server stamped the point on catch-up
 * - `disconnected`: the whole transport is down, a link-wide fact rather than a
 *   per-topic inference. The operator's next move differs: check the relay,
 *   versus this craft is behind the Mun
 * - `last-before-blackout`: server-stamped, the newest sample that got out
 *   before a blackout the Courier already knew about
 * - `recorded`: server-stamped, taken by the subject while out of contact and
 *   replayed on reacquisition. The odd one out: the value is not uncertain at
 *   all, it is exact for its own `asOfUt`, and what makes it a stale grade is
 *   only that the instant is behind the live edge. Reckon FROM it freely; never
 *   draw it as the state of the craft now
 *
 * Expect `reckoning: "available"` to correlate with `last-before-blackout`
 * without the type enforcing it. A model that integrates from the loss of
 * contact needs to know WHEN contact was lost, and that is the only grade that
 * knows, being stamped with the blackout's start. `held-stale` knows only that a
 * heartbeat was missed. A provider with an independent clock on the loss of
 * contact may legitimately reckon from any grade, and a model whose basis is a
 * CAUSE rather than an integration (a conic, a rate) reckons from a live reading
 * just as honestly. That is why the reckoning axis is by whether a model EXISTS
 * rather than by grade, and why it is not part of `state` at all.
 */
export type StaleGrade =
  | "held-stale"
  | "disconnected"
  | "last-before-blackout"
  | "recorded";

/**
 * The staleness discriminant alone, for the handful of types that carry a
 * reading's ARM beside a value they joined from several topics rather than
 * nesting the `Reading` itself (`BudgetProvenance`, `LevelsProvenance`).
 *
 * Derived rather than written out, because both of those spelled the arms as a
 * literal union and both silently went stale the moment another was added: the
 * compiler caught them here, at the assignment, rather than where the mirror was
 * declared. A derived alias makes the next arm propagate on its own.
 *
 * It carries NOTHING about reckoning, and a provenance type wanting that says so
 * with its own {@link ReadingReckoning} field rather than by widening this one.
 * The two axes are independent in `Reading` and stay independent in a mirror of
 * it.
 *
 * This is NOT a licence to replace a `Reading` with its state. A provenance
 * field is for a value that is not one Topic's anything; a widget reading one
 * topic takes the whole `Reading`, so that reaching the value means branching.
 */
export type ReadingState = Reading<unknown>["state"];

/** The reckoning discriminant alone, the companion to {@link ReadingState}. */
export type ReadingReckoning = Reading<unknown>["reckoning"];

/**
 * Drop the model: the written, greppable way for a widget to decline to
 * propagate.
 *
 * It leaves `state` alone, which is the whole point of the axes being separate.
 * A live reading that declines its model is still `observed`, and a stale one is
 * still `stale` at the same grade. Only `reckoning` moves, to `"none"`, and the
 * return type says so: an {@link UnmodelledReading} has no `reckoned` for a
 * caller to reach for afterwards.
 *
 * Note it does not avoid the model's COST: `reckoned` is computed when the
 * reading is built, so by the time a widget declines it the model has already
 * run. This is about what gets DRAWN, not about saving work; a topic whose model
 * is too expensive to run per frame belongs in `NEVER_RECKONABLE`'s
 * too-expensive group instead.
 *
 * Legitimate for a scalar readout that wants the last observed number with a
 * staleness caption and no modelled figure. It exists as a named helper so the
 * decision shows up in review and "which widgets decline to reckon" is a
 * search. Without one, thirty-nine widgets would ignore the discriminant with an
 * inline fallthrough and the optional field would be back by convention.
 *
 * **Never use this on anything that draws a POSITION or an ATTITUDE.** A marker
 * or a reticle placed from a last-known value asserts something about now that
 * it cannot know, and that is the sharpest form of the failure this type
 * exists to prevent. Such a widget should either propagate or stop drawing.
 *
 * It takes a {@link ReckonableReading} too, and strips the {@link
 * ReckoningDecline} along with the model. A widget that has declined to
 * propagate has no use for the reason the model it is not drawing did not fire,
 * and leaving the field on would let one back into a branch it has already
 * opted out of.
 */
// The ReckonableReading overload comes FIRST, and the order is load-bearing.
// `Reading<Pick<T, K>>` accepts a `ReckonableReading<T, K>` by inference (the
// observation is a `T`, and a `T` is assignable to its own projection), so the
// wider declaration first would silently narrow the answer to the projection.
// The reverse cannot happen: a plain `Reading` has no `declined` on its
// value-bearing `"none"` arms, which this type requires.
export function withoutReckoning<T, K extends keyof T>(
  reading: ReckonableReading<T, K>,
): UnmodelledReading<T>;
export function withoutReckoning<T>(reading: Reading<T>): UnmodelledReading<T>;
export function withoutReckoning<T>(
  reading: Reading<T> | ReckonableReading<T, keyof T>,
): UnmodelledReading<T> {
  if (reading.reckoning === "none" && !("declined" in reading)) return reading;
  if (reading.state === "observed") {
    return {
      state: "observed",
      reckoning: "none",
      value: reading.value,
      atUt: reading.atUt,
    };
  }
  return {
    state: "stale",
    reckoning: "none",
    value: reading.value,
    asOfUt: reading.asOfUt,
    grade: reading.grade,
  };
}

/**
 * A `Reading` with no model on offer: every member whose `reckoning` is
 * `"none"`, so `reckoned` is not merely absent at runtime but absent from the
 * type.
 *
 * `stale` is still there and still has to be handled: that is where the
 * judgement lives, and this narrowing does not reduce it. What it removes is a
 * branch a caller could write for a case that cannot occur.
 *
 * Declared here rather than beside `NEVER_RECKONABLE` because two different
 * things produce one: a topic declared unmodellable, and any reading a widget
 * has run {@link withoutReckoning} over.
 */
export type UnmodelledReading<T> = Extract<Reading<T>, { reckoning: "none" }>;

/**
 * Whether the producer has spoken about this topic at all, whatever it said.
 *
 * The question a PRESENCE GATE asks, and five call sites were asking it by hand
 * as `reading.state !== "pending"`: the augment-availability feeder, the map's
 * POI provider gate, the mission log's dock read, the ΔV totals row, and two
 * Uplink test helpers. Every one of them reasoned "pending is the only answer
 * that means nothing is there".
 *
 * That reasoning was complete when `pending` was the only empty arm and stopped
 * being complete the moment `unowned` existed, in the dangerous direction: a
 * hand-rolled `!== "pending"` reads `unowned` as the producer having ANSWERED,
 * when it is the strongest evidence there is that no producer exists. A gate
 * built that way shows an Uplink's UI on an install where the Uplink is not
 * present. Named here so the next arm has one place to be considered rather
 * than five to be missed.
 *
 * `absent` is deliberately TRUE: a producer saying "there is no value" is still
 * a producer, and a tombstone is data. `stale` likewise, since a domain that
 * reported and went quiet is still installed.
 *
 * The two falses are NOT interchangeable even though this collapses them, and a
 * caller that renders something for the user should branch on the arm rather
 * than on this: `pending` may become true on the next frame and `unowned` never
 * will. This answers "should the gate be open", not "what should I say".
 *
 * Takes the discriminant rather than `Reading<T>`, because it reads nothing
 * else and because the callers that need it most cannot supply a `Reading<T>`:
 * a presence gate reads `` `${domain}.available` `` through a runtime `as
 * TopicId` cast, so its reading is the union over EVERY topic and unifies with
 * no single `T`.
 */
export function hasAnswered(reading: {
  readonly state: ReadingState;
}): boolean {
  switch (reading.state) {
    case "pending":
    case "unowned":
      return false;
    case "absent":
    case "observed":
    case "stale":
      return true;
  }
}

/**
 * The instant a reading's OBSERVATION was made, or `undefined` when there has not
 * been one.
 *
 * This replaces `readingAge`, which did the subtraction itself and returned a bare
 * `number`. An age is now `viewUt.minus(observedAt(reading))`, which is a
 * `Value<"s">` natively and renders through `<Unit>` like any other duration: the
 * affine rules made the subtraction say what it means, so a function to do it by hand
 * was one more thing to keep honest.
 *
 * `pending` and `unowned` have no instant: there is no observation to be old, and for
 * `unowned` there never will be. Every other arm has one whether or not a model is on
 * offer, and where one is, the age of the last real contact is the number an operator
 * wants beside the modelled figure.
 *
 * Callers still clamp at zero. Samples arrive out of order (`ClientTimeline`
 * insert-sorts for it), so one can sit marginally ahead of the frame's view time, and
 * "-0.4 s old" is never a thing to render.
 *
 * Takes either union, because the question is about the OBSERVATION and the body
 * switches on `state` alone. A declared value's reading answers it identically:
 * how far a modelled figure has been carried is the same number whether or not
 * the model that carried it was declared in the contract.
 */
export function observedAt<T, K extends keyof T = keyof T>(
  reading: Reading<T> | ReckonableReading<T, K>,
): Value<"ut"> | undefined {
  switch (reading.state) {
    case "pending":
    case "unowned":
      return undefined;
    case "absent":
    case "observed":
      return reading.atUt;
    case "stale":
      return reading.asOfUt;
  }
}

/**
 * A provider of forward models, consulted once per reading. Returning
 * `undefined` is the honest majority answer and leaves the reading
 * `reckoning: "none"`; returning a model makes it `"available"`.
 *
 * `TopicModel.reckon` is what makes the reckoning a pull. This function itself
 * must stay cheap: it is asked whether a model EXISTS and what it covers,
 * which are questions about the basis, not requests to run it.
 *
 * `grade` is `undefined` when the reading is LIVE, and a reckoner is asked on
 * live readings deliberately. A model whose basis is a CAUSE (a conic, a rate)
 * is as true of a value that arrived on time as of one that stopped arriving,
 * and the only thing that used to stop it saying so was reckonability riding the
 * staleness discriminant. A reckoner that genuinely integrates FROM the loss of
 * contact declines on `undefined` and says why.
 *
 * `viewUt` is the third argument because declining is the ONLY way a model has
 * to express a horizon, and a horizon is a statement about how far a value is
 * being carried. Given the point and the grade alone, a reckoner knows when
 * the observation was made and not what it is being asked to reach, so it
 * could not decline at the one moment declining matters. Everything
 * `Reading`'s doc says about `"available"` being the statement of trust rests
 * on this argument existing.
 */
export type ReckonerFor<T> = (
  point: TimelinePoint<T>,
  grade: StaleGrade | undefined,
  viewUt: number,
) => TopicModel<T> | undefined;
