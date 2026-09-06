/**
 * Known `act()` warning debt, per test file. **The tree currently carries none.**
 *
 * This repo's standing rule is that an act warning is ALWAYS our bug. It had no
 * instrument behind it: `pnpm test` structurally cannot show one, because vitest 4's
 * default reporter suppresses console output for tests that PASS, and every act
 * warning is emitted by a passing test. So the tree reported clean on every run while
 * carrying 104 of them, and the standing figure quoted in the ledger was 19.
 *
 * The list below is empty because they were fixed, not because the gate was relaxed.
 * `act-warning-gate.mjs` still runs on every CI push and now fails on the FIRST
 * warning any file emits, which is the state a rule like ours is supposed to be in.
 *
 * A file may be added back only as a deliberate, explained exception. It is a
 * ceiling, never a floor: a file emitting MORE than its entry fails, a file emitting
 * fewer is reported and does not, because the counts are races and a gate that failed
 * on any downward move would go red on an untouched branch on its own schedule.
 *
 * Counts are per FILE, never a single total. A total lets one file's fix pay for
 * another file's regression, and the net would sit still while the tree got worse.
 *
 * Regenerate with `pnpm act-warning-gate --update --only <substring>` and commit the
 * diff alongside whatever you fixed. An unscoped `--update` is REFUSED, because
 * rewriting every entry from one fresh measurement writes that run's roll for every
 * noisy entry the commit never touched; `--all` is the deliberate spelling for
 * seeding or reseeding the lot. An entry carrying a COMMENT is never lowered by
 * either, because a comment marks a number that was chosen rather than measured.
 *
 * ## What was actually behind the 104
 *
 * Three causes, not one, and an early draft of this comment claimed otherwise by
 * generalising from the first two clusters measured:
 *
 *  1. a component with its OWN clock updating during an un-`act`ed real-time wait.
 *     `NavballComponent`'s 24 were one test sleeping 150 ms on purpose to prove a
 *     steady state while the interval under test kept firing
 *  2. an async settle landing AFTER the test body returns: a socket handshake, a
 *     `MutationObserver` callback, a backfill query. Reads like a missing `act` in
 *     the body and is not; the fix is to hold an `await act(async () => {})` open
 *     across the microtask that carries it
 *  3. shared state cleared while the tree is still mounted, so `useSyncExternalStore`
 *     subscribers re-render outside `act`. Clear in `beforeEach`, never `afterEach`,
 *     since RTL's auto-cleanup runs after a user `afterEach`
 *
 * The cheap way to tell 1 from the others: print a marker at the end of the test
 * body. A warning BEFORE the marker is in-body, AFTER it is teardown, and the two
 * want opposite edits. To find the culprit line rather than the component, wrap
 * `console.error` for the run and print `new Error().stack` when the message matches;
 * the React component stack in the warning itself names neither.
 */

/** @type {Record<string, number>} keyed `<package>/<path from package root>`. */
export const KNOWN_ACT_WARNINGS = {
  // Empty on purpose, and the empty object is load-bearing: with no entries, any
  // warning from any file reads as NEW and fails the gate.
};
