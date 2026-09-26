/**
 * The two lists behind `render-fixture-coverage.test.ts`.
 *
 * <p>Every entry is one `<widget dir>#<field>` pair the scan found: a payload
 * field name the widget's own source dereferences, belonging to a topic its
 * fixtures emit, that no fixture in its `__fixtures__` dir ever carries with a
 * non-null value. Which of the two lists it goes in is the whole judgement, and
 * it is a judgement about the MATCH, not about the widget.</p>
 *
 * <p><b>{@link COINCIDENTAL}</b> is for a match that was never a payload read:
 * a plot coordinate called `x`, a canvas call `ctx.arc`, a local spec's own
 * `id`, the `Reading` discriminant `state`. The scan compares NAMES, so these
 * are the price of that approximation and they are not debt anybody can pay.
 * Unconstrained: add and remove by reviewed edit, with the line that earned it
 * quoted in a comment.</p>
 *
 * <p><b>{@link RENDER_GAP}</b> is the real thing: the widget reads the field and
 * no fixture shows it, so the branch that renders it has never been looked at.
 * SHRINK-ONLY, graded against a base revision by the gate's second test. The way
 * off the list is to feed the field in a fixture and look at what it draws.</p>
 */

/**
 * Matches that are not payload reads, so no fixture could ever answer them.
 *
 * Each is quoted with the code that earned it, because the only thing worth
 * checking about one of these in a year is whether that line still says what
 * the comment claims.
 */
export const COINCIDENTAL: readonly string[] = [
  /* `careerReading.state === "observed" || careerReading.state === "stale"`,
     the SDK Reading discriminant the widget branches its whole answer on, not a
     field of `career.status`. */
  "packages/components/src/CareerEconomy#state",
  // `slice.points`, the cross-section geometry the widget builds itself
  "packages/components/src/LandingStatus#points",
  // `reading.state`, the SDK Reading discriminant, not a payload field
  "packages/components/src/LandingStatus#state",
  // plot coordinates in crossSectionPlot.ts (`slice.points[0].x`)
  "packages/components/src/LandingStatus#x",
  "packages/components/src/LandingStatus#y",
  /*
   * `payload.kind === "button"` in the widget's `useActionInput` handler: a
   * SERIAL INPUT discriminant, not a telemetry field. It had no payload field
   * to collide with until `BodyEntry.horizon` landed, which gave `system.bodies`
   * a nested `kind` and made the name a match. ResourceOps reads no body at all;
   * the topic reaches its fixtures through the shared stream.
   */
  "packages/components/src/ResourceOps#kind",
  /*
   * The `s.z` read in useBodyStatePropagators.ts: a component of one
   * `BodyState` off the `system.bodies.statesAt` COMMAND reply, which no
   * channel publishes and no fixture can carry. It collides with the `z` a
   * body's position field has on `system.bodies`, a topic this widget does
   * subscribe to and never reads a `z` off.
   */
  "packages/components/src/TransferWindow#z",
  // `ctx.arc(...)`, the canvas API
  "packages/components/src/MapView#arc",
  /*
   * `const timeToAp = solve?.timeToAp ?? undefined;` and its `timeToPe` twin:
   * the orbital SOLVE's countdowns out of `useOrbitSolve`, not a read of
   * `vessel.orbit`'s own fields of the same names. The widget never
   * dereferences the payload's.
   */
  "packages/components/src/ManeuverPlanner#timeToAp",
  "packages/components/src/ManeuverPlanner#timeToPe",
  // `const { x, y } = project(poi.lat, poi.lon)`, screen coordinates
  "packages/components/src/MapView#x",
  "packages/components/src/MapView#y",
  // `spec.id`, the local facility spec used as a React key
  "packages/components/src/SpaceCenterStatus#id",
  // `reading.state`
  "packages/components/src/SpaceCenterStatus#state",
  "packages/components/src/LaunchDirector#state",
  "packages/components/src/Navball#state",
  "packages/components/src/PowerSystems#state",
  "packages/components/src/ScienceData#state",
  "packages/components/src/Strategies#state",
  /*
   * `reading.state` here too, but TechTree also reads a tech node's own
   * `e.state` in `parseTechNodes`, so the discriminant is not the whole answer.
   * It stays a coincidence for a different reason: the `state` the scan matched
   * belongs to `CareerContract`, which TechTree never reads, and
   * `CareerTechNode` declares `unlocked` and no `state` at all. No fixture of
   * `career.status` can carry the field this widget is looking for.
   */
  "packages/components/src/TechTree#state",
  // `parts.state === "observed"`, the `vessel.parts` Reading's discriminant in `amountReading`
  // `ideal.x` / `cur.x`, chart coordinates in the conformance drawing
  "packages/components/src/TransferWindow#x",
  "packages/components/src/TransferWindow#y",
  /*
   * `body.period` and `body.referenceBody` off `CelestialBody`, the sdk's
   * derived body record (`celestial-facts.ts`: `period` is `2π√(a³/μ_parent)`
   * and `referenceBody` is the parent's resolved NAME). Both share a name with
   * `OrbitPatch`, which TransferWindow never reads: it takes the origin from
   * `orbit.referenceBodyIndex` and everything else from `useCelestialBodies`.
   * The two already render and always have. `period` sets the spacing of the
   * synodic window list ("in 7.3 y", "in 14.6 y") and the transit figures;
   * `referenceBody` is how `parentMu` finds the Sun, without which no row has a
   * Δv at all.
   */
  "packages/components/src/TransferWindow#period",
  "packages/components/src/TransferWindow#referenceBody",
  /*
   * `site.unlocked` on the widget's OWN `LaunchSiteEntry`, which is not the
   * mod's: `spaceCenter.launchSites` declares no such field, and
   * `parseLaunchSites` sets it true for every new-shape entry because the mod
   * enumerates only the sites you can launch from. The name matched
   * `CareerTechNode.unlocked`, reached through the `career.status` these
   * fixtures do emit, and LaunchDirector reads nothing off the tech tree. The
   * field it does read is drawn: `orderPads` filters on it, and a pad list with
   * three sites in it is that filter passing them.
   */
  "packages/components/src/LaunchDirector#unlocked",
];

/**
 * Read by the widget, carried by no fixture: nobody has seen these render.
 *
 * Shrink-only. Adding one is not a way to record a known gap, it is the gate
 * refusing a new one: feed the field in a fixture instead.
 */
export const RENDER_GAP: readonly string[] = [
  "packages/components/src/Objectives#description",
];
