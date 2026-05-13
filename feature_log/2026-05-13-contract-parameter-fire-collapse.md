# Contract-parameter fire collapse

**Date:** 2026-05-13
**Task:** #6 from 2026-05-12 feedback — "Mission Director: alarms pollute top alarm banner heavily"
**Validation:** ⏳ pending — needs live session with multi-objective contract

## Problem

MD-set alarms on every parameter of a multi-objective contract fire one
at a time as the player completes them. Each fired alarm pinned a row to
the bottom-right alarm banner pending user ack, so a four-parameter
contract turned into four stacked banner rows in quick succession.

Contract-parameter fires are informational ("you finished an
objective") rather than actionable, so the operator didn't actually
need to do anything per-row — they needed to acknowledge that all of
them completed.

## Change

When two or more fired alarms are contract-parameter type, the banner
now collapses them into a single row:

```
3 contract objectives completed     [Ack all]
```

- `packages/app/src/alarms/firedCollapse.ts` — pure helper that returns
  `{ count, ids }` when 2+ CPs are fired, else null.
- `AlarmBanner.tsx` — excludes the collapsed IDs from `pickNext` so the
  main row doesn't pick a CP fire as "the next thing"; the collapsed row
  takes the main row when no other alarm wins, otherwise it sits in the
  fired-list section beneath.
- `StationAlarmBanner.tsx` — same collapse on the station-side surface
  so peer screens see the consolidated row, not the stack.
- `firedCollapse.test.ts` — covers the helper.

Single-CP fires are unchanged (no collapse below 2). Threshold and time
alarm fires are unchanged (each still gets its own row with its own
Ack button).

## Behaviour notes

- "Ack all" loops `host.acknowledgeAlarm(id)` over the collapsed ids.
  The peer bridge already mirrors single-id acks, so the loop produces
  N small `alarm-acknowledge` messages — fine at the volume MD fires
  generate.
- If a non-CP alarm is also in fired state, it takes the main row by
  priority (threshold/time > collapsed CP) and the CP collapse falls to
  the fired-list. Mixed state therefore reads as "this is the alarm
  that needs attention; here are N completed objectives below it".

## Files

- `packages/app/src/alarms/firedCollapse.ts` (new)
- `packages/app/src/alarms/firedCollapse.test.ts` (new)
- `packages/app/src/alarms/AlarmBanner.tsx`
- `packages/app/src/alarms/StationAlarmBanner.tsx`

## Validation plan

- Live MD session with a contract that has 3+ parameters; set alarms on
  each. As parameters complete, watch the bottom-right banner.
- Expected: one "N contract objectives completed — Ack all" row, not a
  stack. "Ack all" clears all of them.
- Mixed case: set one threshold alarm (e.g. altitude > X) alongside CP
  alarms; verify threshold takes the main row when fired and CP
  collapse goes to the fired list below.
