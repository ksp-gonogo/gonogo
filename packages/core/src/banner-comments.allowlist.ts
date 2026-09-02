/**
 * Data for the banner-comment ratchet (`styleguide-banner-comments.test.ts`).
 * Pure data module, no test logic, so the shrink-only half of the check can load
 * this file's content at an arbitrary git ref without pulling in vitest or the
 * scan machinery. Same split-module shape as `uplink-isolation.allowlist.ts`.
 *
 * The SHAPE this grades, and why a banner has two spellings, is stated in
 * `banner-comments.matcher.ts`. Read that first; the numbers below are only
 * meaningful against a stated matcher, which is what `MATCHER_REVISION` exists
 * to pin.
 *
 * DECORATION VERSUS DIVISION is the whole judgement, and the shape alone cannot
 * make it. A file carrying `SCHEME_MIN` banners or more is dividing a long
 * table or a long test into named sections, which is not what the rule is aimed
 * at, and is tolerated under `SECTIONED_CEILINGS`. A file carrying one or two is
 * decorating, and belongs in `BANNER_COMMENT_DEBT`.
 *
 * The debt list is consulted BEFORE the scheme rule, so the scheme rule cannot
 * be used to escape the debt list: adding a third banner to a two-banner debt
 * file fails on the count rather than promoting the file out of debt.
 *
 * The debt counts are EXACT, not ceilings. The scan is a static match over a
 * file, so the number is deterministic and there is no measurement noise to
 * absorb, and exactness is what makes the list self-cleaning: clean a banner and
 * the build tells you to lower the number in the same commit, which is the only
 * way a debt list reaches zero by attrition rather than by somebody auditing it.
 */

/**
 * Which matcher the numbers in this file were measured with.
 *
 * Every number below is a measurement, and a measurement means nothing without
 * the instrument that took it. Widening the matcher is therefore the one change
 * that legitimately RAISES a shrink-only number, and a bare shrink-only check
 * cannot tell that from somebody laundering banners they just wrote. So the
 * revision is the declaration: bump it in the same commit as the matcher change
 * and the ratchet re-seeds, leave it alone and every number is shrink-only as
 * before.
 *
 * It is not an escape hatch, because a bump is not taken on trust. The ratchet
 * loads `banner-comments.matcher.ts` AS IT STOOD at the base revision, runs that
 * older matcher over the CURRENT tree, and requires the older numbers to still
 * hold. A reseed therefore proves that everything newly counted is something the
 * old matcher could not see, not something a contributor added. It also requires
 * the matcher source to have actually changed, so the revision cannot be bumped
 * on its own.
 *
 * 1: `// --- Title ---` only, on one line. Seeded 2026-08-22, emptied 2026-09-01.
 * 2: the spread spelling too (a rule, a short title, a rule), and `///` and
 *    block-comment `*` leads. 2026-09-02. Revision 1 could not see 191 of the
 *    423 banners in the tree, including every one in the published `ui-kit`.
 */
export const MATCHER_REVISION = 2;

/**
 * Files carrying an isolated banner comment. SHRINK-ONLY, and the target is
 * zero: delete the banner, or replace it with a sentence that says something the
 * code does not, then lower or remove the entry here in the same commit.
 *
 * Never add a line. A new entry means new code just created the violation, and
 * the rule has been in CLAUDE.md the whole time.
 *
 * Seeded 2026-08-22 at 43 files / 64 banners under revision 1, and emptied on
 * 2026-09-01. RE-SEEDED 2026-09-02 at 32 files / 46 banners under revision 2:
 * the list did not grow, the instrument did. `ui-kit` had five such files and
 * they were cleaned in the same commit rather than seeded, because it is the
 * published package and a third-party author reads it as the example.
 */
export const BANNER_COMMENT_DEBT: Record<string, number> = {
  "mod/GonogoKerbalismUplink.Tests/KerbalismWireParityTests.cs": 2,
  "mod/GonogoKerbalismUplink/client/src/ShipSystems/RadiationSection.test.tsx": 2,
  "mod/GonogoKerbalismUplink/client/src/ShipSystems/index.tsx": 1,
  "mod/Sitrep.Contract.TestSupport/UnitCoverageAssertion.cs": 1,
  "mod/Sitrep.Core.Tests/JsonWriterFlattenerParityTests.cs": 1,
  "mod/Sitrep.Host.IntegrationTests/DomainWireFixtureGeneratorTests.cs": 1,
  "mod/Sitrep.Host.Tests/SystemViewProviderTests.cs": 2,
  "mod/Sitrep.Skeleton.Tests/SkeletonServerIntegrationTests.cs": 1,
  "mod/sitrep-sdk/src/api/coverage/CoverageMaskCache.ts": 1,
  "mod/sitrep-sdk/src/flight/BufferedDataSource.test.ts": 1,
  "mod/sitrep-sdk/src/flight/types.ts": 1,
  "mod/sitrep-sdk/src/spine/orbit-trajectory.test.ts": 1,
  "packages/app/src/__tests__/gonogo-host-service.test.ts": 2,
  "packages/app/src/__tests__/peer-client-service.test.ts": 2,
  "packages/app/src/__tests__/peer-roundtrip.test.ts": 2,
  "packages/app/src/components/Dashboard/index.tsx": 2,
  "packages/app/src/goNoGo/GoNoGoHostService.ts": 2,
  "packages/app/src/peer/PeerHostService.ts": 1,
  "packages/app/src/peer/protocol.ts": 2,
  "packages/app/src/screens/MainScreen.tsx": 1,
  "packages/components/src/FleetRoster/index.tsx": 2,
  "packages/components/src/ManeuverPlanner/index.tsx": 2,
  "packages/components/src/MapView/index.tsx": 1,
  "packages/components/src/Objectives/index.tsx": 2,
  "packages/components/src/OrbitView/index.tsx": 1,
  "packages/components/src/shared/OrbitDiagram.tsx": 1,
  "packages/core/src/actionGroups.ts": 1,
  "packages/core/src/calc/transfer.ts": 2,
  "packages/core/src/styleguide-wall-clock.test.ts": 1,
  "packages/core/src/types.ts": 1,
  "packages/serial/src/mocks/mockWebSerial.ts": 2,
  "packages/serial/src/types.ts": 1,
};

/**
 * A file carrying at least this many banners is treated as a sectioning scheme
 * rather than a decoration, and is tolerated. The number is a judgement, read
 * off the data: at three or more, every such file in the tree turned out to be a
 * long declaration table or a long test divided into named sections, and none
 * was a single decorated statement.
 *
 * The debt list is consulted FIRST, so this cannot be used to escape it. Adding
 * a third banner to a two-banner debt file would otherwise promote that file out
 * of the debt list, and the ratchet would report the change as a cleanup.
 */
export const SCHEME_MIN = 3;

/**
 * Ceilings on the tolerated population, so the exemption cannot spread. Without
 * them, writing three banners into a clean file in one commit is invisible: the
 * file clears `SCHEME_MIN` on arrival and no other check has an opinion.
 *
 * Ceilings rather than exact counts, unlike the debt list, because nothing
 * expects this population to reach zero and a cleanup here should not have to
 * touch this file. Slack left behind by a cleanup is the known cost, and it is
 * bounded by having to fit under BOTH numbers at once.
 *
 * Note what happens when a scheme file is cleaned down to one or two banners
 * rather than none: it drops out of this population and lands as an unlisted
 * decoration, which fails. That is correct rather than a wrinkle, because the
 * two banners left behind are exactly the shape the rule forbids.
 */
export const SECTIONED_CEILINGS = {
  /** Files carrying `SCHEME_MIN` or more banners. 35 under revision 1, 61 under 2. */
  files: 61,
  /** Banner lines across those files. 277 under revision 1, 377 under 2. */
  banners: 377,
} as const;

/**
 * What the scan expects to see when it is working. Floors, not equalities: the
 * point is to fail LOUDLY when the enumeration breaks, and a broken enumeration
 * produces a small number, never a large one.
 *
 * A scan that walks zero files finds zero banners and passes every assertion in
 * the ratchet, so without this the whole file could go green on a renamed
 * directory, a changed `git ls-files` invocation, or a cwd that is not the repo
 * root. `styleguide-earth-day` shipped in exactly that state for weeks.
 */
export const SCAN_FLOORS = {
  /** Hand-written source files walked. 2,784 at seed time, 3,335 on 2026-09-02. */
  files: 2000,
  /** Files carrying at least one banner. 93 under revision 2. */
  filesWithBanner: 70,
  /** Banner lines found. 423 under revision 2. */
  banners: 320,
} as const;
