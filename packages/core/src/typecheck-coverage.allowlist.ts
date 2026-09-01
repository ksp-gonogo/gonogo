/**
 * Data for the typecheck-coverage ratchet (`typecheck-coverage.test.ts`). Pure
 * data module, no test logic, so the shrink-only check can load this file's
 * content at an arbitrary git ref without pulling in vitest or the scanner.
 * Same split-module shape as `uplink-isolation.allowlist.ts`.
 *
 * THE RULE: a package's `typecheck` script must actually typecheck that
 * package's test files.
 *
 * Why it needs a gate at all: `packages/core/tsconfig.json` excluded
 * `src/**\/*.test.ts(x)`, and that same config was what `typecheck` ran, so no
 * core test file had ever been type checked. Around forty of this repo's
 * architectural gates live in exactly those files, so the files enforcing our
 * rules were the files with no type checking. Including them produced 103
 * errors, among them a stale settings narrowing that called itself
 * "ClientPrefSetting" after a third backing landed, and a ratchet fixture still
 * naming five of eleven mod tokens.
 *
 * The exclusion was one line in one config and nothing anywhere said it was
 * there. A comment would not have helped: the whole failure was that the gap
 * was invisible. So the check is mechanical, and it asks the TypeScript
 * compiler itself which files a config resolves to rather than re-implementing
 * include/exclude glob semantics.
 *
 * Every entry below is DEBT and the list is SHRINK-ONLY. Fix one by giving the
 * package a typecheck config that covers its tests (core's split into
 * `tsconfig.json` for everything plus `tsconfig.build.json` for emit is the
 * worked example), then delete the line. Never add one.
 *
 * A note on cost: including tests roughly doubles a package's typecheck input.
 * That is the price of the rule and it is not a reason to stay on this list.
 */

/**
 * Packages whose `typecheck` script does not yet cover their own test files,
 * keyed by workspace-relative directory.
 *
 * The value is what would let the entry leave, per the escape-hatch rule in
 * `docs/ratchets.md`: an entry with no stated exit is a regression with a hall
 * pass, so the companion test fails on an empty or placeholder reason.
 */
export const TYPECHECK_COVERAGE_DEBT: Readonly<Record<string, string>> = {
  "packages/sitrep-client":
    "78 test files, and the app-side spine, so second in value only to the sdk. 160 errors behind the config change, the most of anything left.",
};
