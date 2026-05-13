# Launch Director — in-flight panel

**Date:** 2026-05-13
**Task:** #11 from 2026-05-12 feedback — "Launch Director: rework for in-flight mode"
**Validation:** ⏳ pending — needs a live launch + revert flow in KSP

## Problem

When the player launched a vessel, the widget's `padOccupied`-driven
view dropped the rich pre-launch context and rendered just a minimal
Recover / Revert pair, which felt jarring after staring at the
saved-ships list. Post-crash, a launch attempt also silently failed
with no UI feedback explaining why.

## Change

A new in-flight panel triggers on `kc.scene === "Flight"` (richer
trigger than the previous `kc.padOccupied`). It surfaces:

- Active vessel name (from `v.name`, with `kc.padVesselTitle` fallback).
- Mission time as `T+HH:MM:SS` from `v.missionTime`.
- Altitude from `v.altitude`, formatted `m` or `km`.
- A red "Crash in progress — return to Space Center to recover" chip
  when `crash.hasRecent === true`, with the Recover button disabled.
- Recover / Revert-to-launch / Revert-to-VAB buttons, each greyed out
  with explanatory copy when the corresponding `ksp.canRevert*` key
  reports false.

The pre-launch (Space Center) flow is unchanged. The transitional
`kc.padOccupied && scene === SpaceCenter` state still renders the old
recover/revert mini-bar so post-recovery clicks land somewhere sensible.

## Data wired

New `dataRequirements`:
- `kc.scene` — flight-vs-space-center gate.
- `v.name`, `v.missionTime`, `v.altitude` — in-flight readout.
- `ksp.canRevertToLaunch`, `ksp.canRevertToEditor` — affordance gates.
- `crash.hasRecent` — crash blocking.

Schema meta entries for the new `ksp.canRevert*` keys added to
`telemachusMeta.ts`.

## Tests

Added two regression tests to `LaunchDirector/index.test.tsx`:
- In-flight panel renders mission time + altitude + revert buttons,
  and clicking "Revert to launch" + confirm fires `ksp.revertToLaunch`.
- Crash chip appears and Recover is disabled when `crash.hasRecent: true`.

Existing tests untouched — the Space Center flow they cover is the
same code path.

## Files

- `packages/components/src/LaunchDirector/index.tsx`
- `packages/components/src/LaunchDirector/index.test.tsx`
- `packages/data/src/schema/telemachusMeta.ts` (revert affordance keys)

## Validation plan

- Launch a craft. The widget should switch from the saved-ship list to
  the in-flight panel, showing live mission time and altitude.
- Try Revert-to-launch and Revert-to-VAB — both should work from Flight,
  and both should grey out the moment they're no longer reversible
  (e.g. revert-to-launch becomes unavailable after a save / quickload).
- Crash the vessel. The crash chip should appear and Recover should be
  disabled while crash is recent.
- Recover from a stable landed state. Action should fire successfully.

## Known gaps (not in scope)

- No active-vessel part-count read. The scoping doc mentioned "parts
  lost / parts remaining" comparing `v.partCount` against saved-ship
  partCount, but Telemachus doesn't expose `v.partCount` (the
  parts-API design at `local_docs/2026-05-13-parts-api-design.md`
  covers what a future `v.parts.topology` / `v.parts.state` split
  would look like). Defer until that's shipped.
- No recovery-value preview at current location. The scoping doc
  suggested a `RecoveryDialog` mirror in the fork; not built. The
  fork-side `ksp.recover` action still works, just without a preview
  number.
