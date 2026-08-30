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
 * off the list is to feed the field in a fixture and look at what it draws, the
 * way commit `a718dd36a` did for Principia's ground-track rows.</p>
 *
 * <p>Seeded 2026-08-29 from a full scan: 18 coincidental, 47 render gaps. Paid
 * down the same day on the `packages/components` half: 19 gaps closed by
 * fixtures and 3 reclassified, leaving 25.</p>
 *
 * <p>2026-08-30 took the remaining untriaged entries: 16 down to 3. Ten closed
 * by fixture, three reclassified, and one of the ten found a bug. Feeding
 * MapView its first `vessel.maneuver` node drew the maneuver ground track and,
 * beside it, a full-width horizontal line: the polyline was split at the
 * propagated date line while the canvas draws through the body's texture
 * offset. Every fixture before it was equatorial, where that line lies exactly
 * on the track that drew it. See `MapView/groundTrackWrap.ts`.</p>
 */

/**
 * Matches that are not payload reads, so no fixture could ever answer them.
 *
 * Each is quoted with the code that earned it, because the only thing worth
 * checking about one of these in a year is whether that line still says what
 * the comment claims.
 */
export const COINCIDENTAL: readonly string[] = [
  // `slice.points`, the cross-section geometry the widget builds itself
  "packages/components/src/LandingStatus#points",
  // `reading.state`, the SDK Reading discriminant, not a payload field
  "packages/components/src/LandingStatus#state",
  // plot coordinates in crossSectionPlot.ts (`slice.points[0].x`)
  "packages/components/src/LandingStatus#x",
  "packages/components/src/LandingStatus#y",
  /*
   * `body.atmosphere`, `body.rotationPeriod`, `inputs.surfaceGravity`: the sdk's
   * STATIC body registry, not the `system.bodies` payload. `getBody(name)`
   * returns a `BodyDefinition`, which shares three field names with `BodyEntry`
   * and is a different record with a different source, so no fixture could
   * answer any of them. AtmosphereProfile's pressure curve is drawn from that
   * registry and always has been; LandingStatus never reads a surface gravity
   * at all, it derives one as `body.gm / radius^2` and names the local input
   * after it.
   */
  "packages/components/src/AtmosphereProfile#atmosphere",
  "packages/components/src/LandingStatus#surfaceGravity",
  "packages/components/src/MapView#rotationPeriod",
  // `ctx.arc(...)`, the canvas API
  "packages/components/src/MapView#arc",
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
  "packages/components/src/TechTree#state",
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
  /*
   * `AeroDescentInputs.surfaceGravity`, the widget's own derived input, not the
   * `BodyEntry.surfaceGravity` the name matched. The widget never reads that
   * field: `surfaceGravityOf` resolves the parent body's NAME through
   * `system.bodies` and then takes `gm / radius²` from the sdk's client-side
   * body registry. The modelled descent it feeds does render, from the fixtures
   * that are already there, and `ballistic-capsule` is built around it.
   */
  "mod/GonogoFerramAerospaceResearchUplink/client/src/DescentEnvelope#surfaceGravity",
];

/**
 * Read by the widget, carried by no fixture: nobody has seen these render.
 *
 * Shrink-only. Adding one is not a way to record a known gap, it is the gate
 * refusing a new one: feed the field in a fixture instead.
 */
export const RENDER_GAP: readonly string[] = [
  /*
   * Not closeable from a fixture, and the reason is on the producer.
   * `AnalysisReader` passes `null` for a VESSEL's own analysis and the coast's
   * start time for a coast, because Principia anchors a vessel analysis
   * wherever the craft's history ended and publishes no instant for it. So this
   * topic can only ever carry null here, `AgeLine`'s "Elements of unknown age"
   * branch is the one every render of this widget shows, and the dated branch
   * belongs to CoastAnalysis, whose fixtures do carry an epoch. Feeding a
   * number here would be inventing a frame the game cannot send.
   */
  "mod/GonogoPrincipiaUplink/client/src/OrbitAnalysis#elementsEpochUt",
  "packages/components/src/Objectives#description",
  "packages/components/src/TechTree#description",
];
