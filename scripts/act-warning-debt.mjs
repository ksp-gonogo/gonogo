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
 *  - a file emitting FEWER also fails, so a fix forces its number down here rather
 *    than leaving slack behind for the next regression to hide in
 *
 * Counts are per FILE, never a single total. A total lets one file's fix pay for
 * another file's regression, and the net would sit still while the tree got worse.
 *
 * Regenerate with `pnpm act-warning-gate --update` and commit the diff alongside
 * whatever you fixed.
 *
 * ## What is actually behind these
 *
 * Not the two causes `CLAUDE.md` documents. The dominant pattern, measured across
 * all of them, is a component with its OWN clock or subscription updating during an
 * un-`act`ed real-time wait: a coalescing interval, a staleness clock, a UT
 * observer, slot-registration effects. Four components account for 74 of them
 * (`NavballComponent` 24, `SpaceWeatherComponent` 22, `KspCalendarObserver` 17,
 * `SlotAggregator` 11, with `AugmentSlot`'s 8 being the same system as the last).
 *
 * The largest single entry is one test that sleeps 150 ms outside `act()` on
 * purpose, to prove a steady state, while the interval under test keeps firing.
 */

/** @type {Record<string, number>} keyed `<package>/<path from package root>`. */
export const KNOWN_ACT_WARNINGS = {
  "components/src/Navball/control-delay-stream.test.tsx": 24,
  // INTERMITTENT, and the worst of them: measured at 0, 1 and 21 across four runs of
  // an unchanged tree, the 21 on a box at load 15. It is a race, so contention buys
  // it more chances to fire rather than fewer. Seeded at the observed MAXIMUM so
  // ordinary noise cannot exceed it, which costs regression sensitivity on this one
  // file and is the honest price of ratcheting a quantity that is not stable. Fixing
  // the race is what makes this entry tight again.
  "components/src/Navball/index.test.tsx": 21,
  "components/src/SpaceWeather/stale.test.tsx": 12,
  "components/src/SpaceWeather/undefined.characterise.test.tsx": 10,
  "components/src/TargetPicker/index.test.tsx": 6,
  "components/src/FleetReliability/index.test.tsx": 3,
  "components/src/MapView/index.test.tsx": 2,
  "components/src/ShipMap/partActions.test.tsx": 2,
  "components/src/FleetReliability/composition.test.tsx": 2,
  "components/src/PowerSystems/undefined.characterise.test.tsx": 1,
  "app/src/settings/SettingsModal.test.tsx": 3,
  "sitrep-client/src/use-command.test.tsx": 2,
  "sitrep-client/src/auto-command.hook.test.tsx": 1,
  "ui-kit/src/Tabs.test.tsx": 2,
  "gonogo-kerbalism-uplink/src/ShipSystems/index.test.tsx": 1,
  "gonogo-scansat-uplink/src/Scanning/index.test.tsx": 1,
};
