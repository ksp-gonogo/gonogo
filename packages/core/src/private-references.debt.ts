/**
 * Data for the private-reference ratchet (`private-references.test.ts`): the
 * tracked files that still carry a match, and how many matches each holds.
 * SHRINK-ONLY. A file may lower its number or leave the list; it may not join
 * it or go up. Clear one by rewording the line, then lower the number.
 */
export const PRIVATE_REFERENCE_DEBT: Record<string, number> = {
  // Ignore entries for local, untracked working folders.
  ".gitignore": 2,
  "packages/core/turbo.json": 1,
  // Gates whose messages and test data name the matched strings on purpose.
  ".githooks/commit-msg": 3,
  "packages/core/src/commit-msg-hook.test.ts": 5,
  "packages/core/src/published-design-doc-refs.allowlist.ts": 2,
  "packages/core/src/published-design-doc-refs.test.ts": 4,
  // Local-machine helpers that resolve paths under the home directory.
  "packages/storybook/scripts/ledger.ts": 1,
};
