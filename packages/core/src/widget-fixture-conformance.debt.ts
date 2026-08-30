/**
 * The shrink-only list behind `widget-fixture-conformance.test.ts`.
 *
 * <p>Every entry is one `<widget dir>#<topic>.<field>` triple the scan found: a
 * field name a fixture in that widget's `__fixtures__` dir puts on that topic
 * that the generated contract does not declare anywhere in that topic's shape.
 * There is no second list and no coincidental class, because unlike a
 * name-matching scan this one is positional: the field was sent, on a topic the
 * contract owns, at a position the contract describes, and the mod cannot
 * produce it. The fixture is describing a wire that does not exist.</p>
 *
 * <p><b>The way off this list is to fix the fixture</b>, then look at what the
 * corrected shape renders. That second half is the point: `departmentName` did
 * not merely fail to draw, it drew a reputation cost of 13.97 where the shape
 * the mod actually sends produces 7.3, for months, with green tests.</p>
 *
 * <p>Seeded 2026-08-30 from a full scan of 66 fixture directories: 18 entries,
 * 501 individual occurrences. Four of the five defects that prompted the gate
 * were already fixed by hand the day before and are correctly absent; the ones
 * below are what was left, plus two nobody had found.</p>
 */

/**
 * Fields a fixture sends that the contract does not declare at that position.
 *
 * SHRINK-ONLY, graded against a base revision by the gate's last test. Adding
 * an entry is not how a new one is recorded, it is the gate refusing it.
 */
export const FIXTURE_CONTRACT_DRIFT: readonly string[] = [
  /*
   * The legacy short-code facility shape, on the enum-keyed
   * `career.status.facilities` record. `CareerFacility` declares
   * `currentTier` / `maxTier` / `upgradeCost`; every one of these fixtures
   * sends `level` / `max` / `upgradeFunds` and two text lines that were never
   * on the wire at all. This is the third of the five defects that prompted
   * the gate and it is still in three widgets' fixtures, 421 occurrences of
   * it, which is why the enum-keyed record the mod really sends has never
   * rendered anywhere.
   */
  "mod/GonogoRp1Uplink/client/src/KscComplexes#career.status.level",
  "mod/GonogoRp1Uplink/client/src/KscComplexes#career.status.max",
  "mod/GonogoRp1Uplink/client/src/KscConstruction#career.status.level",
  "mod/GonogoRp1Uplink/client/src/KscConstruction#career.status.max",
  "packages/components/src/SpaceCenterStatus#career.status.currentLevelText",
  "packages/components/src/SpaceCenterStatus#career.status.level",
  "packages/components/src/SpaceCenterStatus#career.status.max",
  "packages/components/src/SpaceCenterStatus#career.status.nextLevelText",
  "packages/components/src/SpaceCenterStatus#career.status.upgradeFunds",
  /*
   * A real field on the wrong type. `rolloutRefusals` is declared on
   * `Rp1WarehouseItemEntry`, which is what `rp1.warehouse` carries, and NOT on
   * the `Rp1BuildItemEntry` rows of `rp1.buildQueue` these fixtures attach it
   * to. A refusal shown against a queued build is a refusal the mod reports
   * about a finished, warehoused vehicle.
   */
  "mod/GonogoRp1Uplink/client/src/VehicleAssembly#rp1.buildQueue.rolloutRefusals",
  /*
   * `ScienceInstrumentEntry` declares `partName` / `experimentId` /
   * `dataIsCollectable`. The second of the five defects, still in four
   * fixtures.
   */
  "packages/components/src/Experiments#science.instruments.expId",
  "packages/components/src/Experiments#science.instruments.hasData",
  "packages/components/src/Experiments#science.instruments.partTitle",
  /*
   * `LaunchSiteEntry` locates a site by `bodyIndex`, never by a body NAME.
   * Nothing on the wire has ever carried this string.
   */
  "packages/components/src/LaunchDirector#spaceCenter.launchSites.body",
  // Neither is declared on the science experiment entry.
  "packages/components/src/ScienceData#science.experiments.scienceValueBase",
  "packages/components/src/ScienceData#science.experiments.transmitBoost",
  /*
   * The first of the five, and the one with a wrong NUMBER on screen rather
   * than a blank: `CareerStrategy` declares `department` and no
   * `effectiveCostReputation` at all. One fixture,
   * `new-wire-department-shape.json`, already carries the real shape; the
   * other five in that directory do not, and the widget still normalises both
   * so that neither the render nor a test can tell them apart.
   */
  "packages/components/src/Strategies#career.status.departmentName",
  "packages/components/src/Strategies#career.status.effectiveCostReputation",
];
