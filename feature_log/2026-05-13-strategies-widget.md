# Strategies / Admin Building widget

**Date:** 2026-05-13
**Task:** #25 from 2026-05-12 feedback — "Need admin building data/widget for strategies"
**Validation:** ⏳ pending — needs live session against the new Telemachus fork build

## Overview

New `@gonogo/components` widget exposing KSP's Administration Building
strategies through the Telemachus fork's `strategies.*` keys (shipped
2026-05-13). The widget:

- Lists the currently active strategy, its effect bullets stripped of
  KSP rich-text markup, and a Deactivate flow with confirm-step.
- Lists available strategies (the ones gated only by the admin-tier
  active-count cap stay visible with a "Deactivate the running
  strategy first" hint, since they're real options once the slot is
  freed).
- Lists requirement-locked strategies (e.g. needs more reputation)
  separately so the operator can see what's coming next.
- Shows the cost preview (funds / science / reputation) scaled by the
  commitment-factor slider, and flags insufficient currencies inline.
- For reputation costs, uses the fork's `effectiveCostReputation` field
  so the displayed cost matches the post-curve deduction KSP will
  actually charge.
- Header shows live funds / reputation / science — per the
  "spend-funds widgets must display the balance" rule.

## Files

- `packages/components/src/Strategies/index.tsx` (new)
- `packages/components/src/Strategies/index.test.tsx` (new)
- `packages/components/src/index.ts` (export)
- `packages/data/src/schema/telemachusMeta.ts` (`strategies.all` meta)

## Behaviour notes

- Activate / Deactivate both go through a two-step confirm to avoid
  accidental commits. Arm and pending states each have a 5s safety
  timeout so a half-clicked action doesn't leave the UI in an
  ambiguous state.
- Soft-block reason ("more than 1 active strategies at this level") is
  detected by regex on `activateBlockedReason` so the widget can
  preserve the strategy in the Available list instead of dumping it
  into Locked. Other block reasons (rep gate, conflict, can't afford)
  go to Locked as authoritative.
- Effect text parser drops the trailing "Setup Cost:" block KSP adds
  to every strategy — the explicit cost fields already cover that, so
  showing it twice would be noise.

## Open follow-up

The fork's `strategies.all` runs the replica logic against
`StrategySystem.Instance.Strategies` directly, which we discovered can
silently exceed the admin-tier active-strategy cap when the player
activates a second strategy via the in-game dialog while one is
already active externally (see
[[project_ksp_strategy_overcap_quirk]]). The widget treats every
`isActive: true` row as active, so the over-cap state is visible —
neither the widget nor the fork swallows it. Worth surfacing as a
warning row in a follow-up session if the over-cap state proves
common in practice.

## Validation plan

- Pull up the widget in Space Center, Editor, Flight, and Tracking
  Station. The replica works in any scene, so all should populate.
- Activate a strategy, confirm the in-game Admin Building reflects it.
- Deactivate, confirm the same.
- Verify the cost preview matches the actual deduction on activate
  (post-curve reputation cost in particular).
- Verify the locked / available split — soft-blocked strategies should
  appear in Available with a hint; rep-gated ones in Locked.
