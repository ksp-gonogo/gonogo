/**
 * Known `act()` warning debt, per test file. **These counts may only ever SHRINK.**
 *
 * This repo's standing rule is that an act warning is ALWAYS our bug. It had no
 * instrument behind it: `pnpm test` structurally cannot show one, because vitest 4's
 * default reporter suppresses console output for tests that PASS, and every warning
 * below is emitted by a passing test. So the tree reported clean on every run while
 * carrying 104 of them, and the standing figure quoted in the ledger was 19.
 *
 * They are recorded here rather than left as a permanently red CI job, for the same
 * reason `unfed-snapshot-debt.ts` exists: a job that is always red stops being a
 * signal and hides the next unrelated failure behind it.
 *
 * `act-warning-gate.mjs` holds this list from both sides:
 *
 *  - a file emitting MORE than its entry fails, which is the regression the gate
 *    exists to catch
 *  - a file emitting FEWER is REPORTED and does not fail. That is not the stricter
 *    rule this file first described: the count is not stable enough for it. Five runs
 *    of an unchanged tree gave 104, 100, 104, 124 and 103, because the causes behind
 *    them are races, so a gate that failed on any downward move would go red on an
 *    untouched branch on its own schedule
 *
 * Counts are per FILE, never a single total. A total lets one file's fix pay for
 * another file's regression, and the net would sit still while the tree got worse.
 *
 * Regenerate with `pnpm act-warning-gate --update --only <substring>` and commit the
 * diff alongside whatever you fixed. Prefer `--only`: a bare `--update` rewrites every
 * entry from one fresh measurement, so a commit about one widget also writes down that
 * run's roll for every noisy entry it never touched. An entry carrying a COMMENT is
 * never lowered by either, because a comment marks a number that was chosen rather
 * than measured.
 *
 * ## What is actually behind these
 *
 * At least three causes, not one, and an early draft of this comment claimed
 * otherwise by generalising from the first two clusters measured:
 *
 *  1. a component with its OWN clock updating during an un-`act`ed real-time wait.
 *     `NavballComponent`'s 24 were one test sleeping 150 ms on purpose to prove a
 *     steady state while the interval under test kept firing. Fixed
 *  2. an async settle landing AFTER the test body returns: a socket handshake
 *     completing late, which reads like a missing `act` in the body and is not
 *  3. shared state cleared while the tree is still mounted, so `useSyncExternalStore`
 *     subscribers re-render outside `act`. Clear in `beforeEach`, never `afterEach`
 *
 * 2 and 3 are the same fix and differ only in disguise. The cheap way to tell 1 from
 * them: print a marker at the end of the test body. A warning BEFORE the marker is
 * in-body, AFTER it is teardown, and the two want opposite edits.
 */

/** @type {Record<string, number>} keyed `<package>/<path from package root>`. */
export const KNOWN_ACT_WARNINGS = {
  "components/src/ShipMap/partActions.test.tsx": 2,
  "sitrep-client/src/use-command.test.tsx": 2,
  "ui-kit/src/Tabs.test.tsx": 2,
  "components/src/PowerSystems/undefined.characterise.test.tsx": 1,
  "sitrep-client/src/auto-command.hook.test.tsx": 1,
};
