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
export const FIXTURE_CONTRACT_DRIFT: readonly string[] = [];
