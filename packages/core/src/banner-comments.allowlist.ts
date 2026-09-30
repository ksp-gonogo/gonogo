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
 * The tree is at zero: `BANNER_COMMENT_DEBT` is empty and there is no tolerated
 * sectioning exemption any more (see `styleguide-banner-comments.test.ts` for
 * the history of `SECTIONED_CEILINGS` and `SCHEME_MIN`, retired 2026-09-30 once
 * `mod/`'s last 37 files / 201 banners were cleaned, Saga 697 second slice). A
 * file that genuinely needs sections gets a plain sentence on the thing it
 * introduces, never a decorated banner.
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
 * 1: `// --- Title ---` only, on one line.
 * 2: the spread spelling too (a rule, a short title, a rule), and `///` and
 *    block-comment `*` leads. Revision 1 could not see 191 of the
 *    423 banners in the tree, including every one in the published `ui-kit`.
 */
export const MATCHER_REVISION = 2;

/**
 * Files carrying an isolated banner comment. SHRINK-ONLY, and empty: every
 * banner in the tree is gone. Never add a line. A new entry means new code
 * just created the violation, and the rule has been in CLAUDE.md the whole
 * time.
 *
 * Seeded 2026-08-22 at 43 files / 64 banners under revision 1, and emptied on
 * 2026-09-01. RE-SEEDED 2026-09-02 at 32 files / 46 banners under revision 2:
 * the list did not grow, the instrument did. `packages/` went to zero on
 * 2026-09-30 (Saga 697, first slice), and `mod/` (the last 9 entries) followed
 * in the same task's second slice.
 */
export const BANNER_COMMENT_DEBT: Record<string, number> = {};

/**
 * What the scan expects to see when it is working. A floor, not an equality:
 * the point is to fail LOUDLY when the enumeration breaks, and a broken
 * enumeration produces a small number, never a large one.
 *
 * A scan that walks zero files finds zero banners and passes every assertion in
 * the ratchet, so without this the whole file could go green on a renamed
 * directory, a changed `git ls-files` invocation, or a cwd that is not the repo
 * root. `styleguide-earth-day` shipped in exactly that state for weeks.
 *
 * The population floors this file used to carry alongside it
 * (`filesWithBanner`, `banners`) are gone: the real count is zero and a floor
 * cannot sit above zero without failing on a clean tree. The instrument check
 * for "did the scan actually look at banners" is now the planted-violation test
 * in `styleguide-banner-comments.test.ts`, the same shape every other
 * zero-count scan in this tree uses.
 */
export const SCAN_FLOORS = {
  /** Hand-written source files walked. 2,784 at seed time, 3,940 on 2026-09-30. */
  files: 2000,
} as const;
