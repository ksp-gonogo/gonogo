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
 * <p>Seeded 2026-08-29 from a full scan: 18 coincidental, 47 render gaps.</p>
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
  // `selectedPreset.description`, a locally defined burn preset
  "packages/components/src/ManeuverPlanner#description",
];

/**
 * Read by the widget, carried by no fixture: nobody has seen these render.
 *
 * Shrink-only. Adding one is not a way to record a known gap, it is the gate
 * refusing a new one: feed the field in a fixture instead.
 */
export const RENDER_GAP: readonly string[] = [
  "mod/GonogoFerramAerospaceResearchUplink/client/src/DescentEnvelope#surfaceGravity",
  "mod/GonogoKerbalismUplink/client/src/CrewSurvival#deathClockUt",
  "mod/GonogoKosUplink/client/src/KosTerminal#partName",
  /*
   * The four rows commit a718dd36a did NOT reach. It gave the ground-track rows
   * a fixture; the collision, collision-risk and reentry instants and the
   * elements epoch are still null in every scene, so the rows that announce a
   * predicted reentry have never been drawn.
   */
  "mod/GonogoPrincipiaUplink/client/src/OrbitAnalysis#elementsEpochUt",
  "mod/GonogoPrincipiaUplink/client/src/OrbitAnalysis#firstCollisionRiskUt",
  "mod/GonogoPrincipiaUplink/client/src/OrbitAnalysis#firstCollisionUt",
  "mod/GonogoPrincipiaUplink/client/src/OrbitAnalysis#firstReentryUt",
  "mod/GonogoRp1Uplink/client/src/LaunchComplexStatus#associatedVesselId",
  "mod/GonogoRp1Uplink/client/src/ProgramDetail#completedUt",
  "mod/GonogoRp1Uplink/client/src/VehicleAssembly#waitingVesselName",
  // `body.atmosphere`: no fixture body carries the sub-object, so the profile
  // this widget exists to draw has never been drawn from a fixture
  "packages/components/src/AtmosphereProfile#atmosphere",
  "packages/components/src/CurrentOrbit#period",
  "packages/components/src/CurrentOrbit#points",
  "packages/components/src/Experiments#dataAmount",
  "packages/components/src/Experiments#dataIsCollectable",
  "packages/components/src/Experiments#experimentId",
  "packages/components/src/FleetReliability#limitCount",
  "packages/components/src/FleetReliability#usedCount",
  "packages/components/src/LandingStatus#dragToWeightRatio",
  "packages/components/src/LandingStatus#mach",
  "packages/components/src/LandingStatus#surfaceGravity",
  "packages/components/src/LaunchDirector#facilityOrdinal",
  "packages/components/src/LaunchDirector#unlocked",
  "packages/components/src/LaunchDirector#ut",
  "packages/components/src/ManeuverPlanner#orbit",
  "packages/components/src/ManeuverPlanner#points",
  "packages/components/src/MapView#bodyIndex",
  "packages/components/src/MapView#rotationPeriod",
  "packages/components/src/MapView#ut",
  "packages/components/src/Objectives#description",
  "packages/components/src/OrbitView#points",
  "packages/components/src/ScienceData#partName",
  "packages/components/src/SpaceCenterStatus#currentTier",
  "packages/components/src/SpaceCenterStatus#facilityOrdinal",
  "packages/components/src/SpaceCenterStatus#maxTier",
  "packages/components/src/SpaceCenterStatus#upgradeCost",
  "packages/components/src/Strategies#department",
  // `orbit?.encounter`: no fixture puts the vessel on an intercept, so the
  // encounter row and its transition instant are unrendered
  "packages/components/src/SystemView#encounter",
  "packages/components/src/SystemView#transitionType",
  "packages/components/src/SystemView#transitionUt",
  "packages/components/src/TargetPicker#bodyIndex",
  "packages/components/src/TargetPicker#partId",
  "packages/components/src/TargetPicker#situation",
  "packages/components/src/TargetPicker#vesselId",
  "packages/components/src/TechTree#description",
  "packages/components/src/TransferWindow#period",
  "packages/components/src/TransferWindow#referenceBody",
];
