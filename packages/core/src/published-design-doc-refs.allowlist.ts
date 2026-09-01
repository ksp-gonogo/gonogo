/**
 * Data for the published-design-doc-refs ratchet
 * (`published-design-doc-refs.test.ts`). Pure data module, no test logic, same
 * split-module shape as the other allowlists here.
 *
 * THE RULE: a comment that reaches a third-party author's install may not point
 * at a document only this repo has.
 *
 * Read the test file for why `published-doc-reachability` cannot see this class,
 * and for which comments actually reach an author in each package.
 */

/** Where a comment reaches an author, and by which route. */
export const PUBLISHED_COMMENT_SURFACES = [
  {
    dir: "mod/sitrep-sdk/src",
    /*
     * `src` is in the package's `files`, so every comment in a non-test file is
     * copied verbatim into an author's `node_modules`, `//` headers included.
     */
    jsdocOnly: false,
  },
  {
    dir: "packages/ui-kit/src",
    /*
     * Ships only `dist`, so a `//` note is a note to us and never leaves. JSDoc
     * does leave, through tsup's `.d.ts` emit: twelve `§` references were
     * measured in the published `index.d.ts` when this was written.
     */
    jsdocOnly: true,
  },
] as const;

/**
 * The reference shapes, as `[source, flags]` rather than `RegExp` literals so a
 * revision of this list can be compared as data.
 *
 * `docs/` on its own is deliberately absent: `docs/creating-an-uplink.md` and
 * `docs/uplink-isolation.md` are committed and are exactly where an author
 * should be sent, so only the gitignored `docs/superpowers/` subtree matches.
 *
 * `§` is matched only when a digit follows. A bare section sign appears in
 * ordinary prose and would make this fire on writing rather than on pointers.
 * `§[0-9]` also subsumes every `design §4.5` / `spec §14` spelling, so there is
 * no separate pattern for those: two patterns matching one reference would
 * double-count it and make the reported total meaningless.
 */
export const DESIGN_DOC_REF_PATTERNS: readonly (readonly [string, string])[] = [
  ["\\blocal_docs/[A-Za-z0-9_./-]*", ""],
  ["\\bdocs/superpowers/[A-Za-z0-9_./-]*", ""],
  ["\\b[a-z0-9][a-z0-9-]*-(?:design|spec|plan)(?:\\.md)?\\b", ""],
  ["§[0-9][0-9.]*", ""],
  ["\\bdesign\\s+(?:doc|D-[A-Z]|R-[A-Z])\\b", "i"],
  ["\\bUplink architecture spec\\b", ""],
];

/**
 * Ordinary English that the document-filename pattern above would otherwise
 * match. Measured, not guessed: these two are what it hit on the live tree.
 *
 * Kept as an exclusion after the match rather than folded into the pattern as a
 * lookahead, so the next one is a one-word edit that reads as what it is.
 */
export const ORDINARY_COMPOUNDS: readonly string[] = [
  "by-design",
  "maneuver-plan",
];

/**
 * PER FILE AND LINE, seeded empty: every instance the census found was rewritten
 * rather than listed, so a first entry here is a fresh violation and not seed
 * residue.
 *
 * Entries are `<file>:<line>`. That is a deliberately brittle key, because a
 * line-numbered entry goes stale the moment the file is edited, which is
 * precisely when the sentence should be rewritten instead of re-listed.
 */
export const DESIGN_DOC_REF_DEBT: readonly string[] = [];
