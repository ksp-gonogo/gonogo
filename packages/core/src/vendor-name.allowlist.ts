/**
 * Data for the vendor-name ratchet (`vendor-name.test.ts`). Pure data module, no
 * test logic, so the counts can be read at an arbitrary git ref without pulling
 * in vitest or the scan. Same split-module shape as
 * `uplink-isolation.allowlist.ts`.
 *
 * WHAT THIS GUARDS. The app's telemetry source before the R6 cutover was a
 * third-party mod, and its key vocabulary (`o.sma`, `v.altitude`, `tar.o.PeA`)
 * outlived it as the API 27 widgets were written against. The operator has asked
 * for the name to be removed from the codebase several times; each sweep removed
 * instances and the total barely moved, because nothing counted it. Two reasons
 * it did not move, both invisible without an instrument:
 *
 *   - the vocabulary was a live API, so a string-level sweep could not touch it
 *     without migrating 27 widgets first
 *   - comments kept RE-INTRODUCING the name as provenance ("the old X `o.sma`"),
 *     which reads as good practice and was the thing being asked against
 *
 * So this counts PROSE, not just symbols. A symbol-only guard would have called
 * `mod/sitrep-sdk` clean on the day the spine moved there carrying 86 lines of
 * doc comment naming the vendor.
 *
 * WHERE THE PROVENANCE LIVES NOW: `local_docs/design/`, every removed comment
 * reproduced verbatim under its file and line. Deleting a mention here loses
 * nothing. What must NOT be lost is a comment that records a SEMANTIC
 * DISTINCTION rather than a rename: those get rewritten to state the
 * distinction without the name. The cost of getting that wrong is not abstract,
 * a duration and an instant were collapsed into one field and shipped a
 * twenty-minute encounter as "46d 2h" in two widgets.
 *
 * NEITHER THIS FILE NOR ITS TEST SPELLS THE NAME. A grep that names its own
 * needle is a file the sweep can never finish, so the test assembles the
 * pattern from fragments instead and both files come out clean. That is why
 * there is no self-exemption here any more.
 *
 * EXEMPT: `CLAUDE.md` and `local_docs/**` keep their history.
 *
 * SHRINK-ONLY, and the counts are EXACT. Clean a file and the test fails until
 * you lower its number; that is the ratchet, and it is why the numbers are here
 * rather than a bare file list. Remove the entry entirely when it reaches zero.
 * Never raise a number and never add a file.
 */

/**
 * `mod/sitrep-sdk/**`: the PUBLISHED, author-facing surface, kept separate
 * because a line here is worse than a line anywhere else. A third-party Uplink
 * author reads this package and cannot install any of ours; a vendor name in it
 * is both noise and, where the comment points into `packages/*`, a pointer to
 * something they cannot obtain.
 *
 * THIS BUCKET IS AT ZERO as of 2026-08-20, so it is no longer a shrinking list,
 * it is a hard gate: any entry appearing here at all is a regression, and the
 * test says so rather than asking for a number to be lowered.
 *
 * It reached zero the hard way. The stream spine moved into this package for
 * test-ergonomics reasons and carried 86 lines of doc comment with it,
 * including a legacy-key-table header that pointed an outside author at
 * `packages/components/src`, a directory they cannot obtain. Nothing caught
 * that, because nothing was counting. Keeping it empty is cheaper than clearing
 * it twice.
 */
export const SDK_SURFACE: Readonly<Record<string, number>> = {};

/**
 * Everything else in the tree: app packages, the mod's C# side, tests and
 * recorded fixtures. Same shrink-only rule, lower priority than the SDK bucket
 * because none of it is read by anyone outside this repo.
 *
 * Empty. The tree carries none, so the gate now fails on the first line that
 * reappears anywhere rather than on growth against a budget.
 */
export const APP_INTERNAL: Readonly<Record<string, number>> = {};
