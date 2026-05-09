# Action-group alarm UI

- **Date:** 2026-05-09
- **Validation:** ⏳ pending — exercise the bell + onFire dispatch in a live KSP session before marking confirmed.
- **Commits:** `6c81cd6` (this work). Predecessor `6b0cff1` (host-side dispatch, prior session, also unvalidated).
- **Plan:** `local_docs/action_group_alarm_ui_plan.md` (local only — `local_docs/` is gitignored)

Captures what actually shipped so future me can find their way back during a
regression hunt.

`6b0cff1` introduced `AlarmFireAction` + host-side dispatch. This change adds
the three user-visible surfaces.

## What landed

1. **Peer-protocol passthrough** — `alarm-add` and `alarm-update.patch` carry an
   optional `onFire: AlarmFireAction[]`. Stations can therefore create alarms
   with attached side effects.
2. **Modal editor** — the alarms modal grew a "When fires" section. Operators
   pick action-group toggles (`f.ag1`, `f.stage`, …) and attach them to a new
   or existing alarm. Inline chip list on each alarm row with × to remove.
3. **ActionGroup widget bell** — clicking the bell next to the state pill opens
   the alarms modal pre-populated with `onFire = [{ kind: "action-group",
   action: <this group's toggle> }]` so the operator only fills in the
   trigger.

## Key contracts (don't break these)

- **Empty array clears `onFire`.** `addAlarm` and `updateAlarm` both normalise
  `onFire: []` to `onFire: undefined`. The wire format never carries an empty
  array on a stored alarm — the storage form is always `undefined` or a
  populated array. Consumer code (`a.onFire && a.onFire.length > 0`) is the
  canonical check.
- **`undefined` in a patch leaves the field alone.** Only an array (empty or
  populated) signals intent to change. Same pattern as `notes` and `trigger`.
- **`migrateAlarm` propagates `onFire`.** Originally it dropped the field on
  reload; `parseOnFire(raw)` validates each entry and discards garbage. Tests:
  `AlarmHostService.test.ts` "persists onFire alongside the alarm" + "loads
  pre-onFire persisted alarms cleanly".
- **Wire format is back-compat.** Older stations omit `onFire`; older hosts
  receiving it ignore the unknown field. No migration code; tests assert v1
  records without `onFire` round-trip cleanly.
- **Central pipeline still owns dispatch.** `notifyFire` → `dispatchOnFire`
  awaits `telemetry.execute` per attached action; per-action errors are
  swallowed so one missing AG doesn't block the rest. Don't add a parallel
  warp-down / acknowledge path for action-group fires.
- **The bell is hidden when there's no toggle action.** Read-only groups
  (Precision Control) have `toggle: null` in `ACTION_GROUPS` and wouldn't be
  dispatchable anyway. Same filter `FIRABLE_ACTIONS` in `AlarmsModal`.

## File map

```
packages/app/src/alarms/
  types.ts                       — AlarmFireAction (was already there);
                                   migrateAlarm now propagates onFire via
                                   parseOnFire().
  AlarmHostService.ts            — addAlarm/updateAlarm accept onFire; empty
                                   array = clear sentinel.
  AlarmPeerBridge.ts             — forwards onFire from peer alarm-add into
                                   the host's addAlarm.
  AlarmClientService.ts          — passthrough.
  AlarmsModal.tsx                — OnFireEditor + chip list on rows; prefill
                                   prop seeds name + onFire on first mount.
  AlarmsLauncherBridge.tsx       — NEW. Wraps useModal().open with the
                                   right backend bindings; provides the
                                   AlarmsLauncher context to descendants.
  AlarmsFab.tsx                  — type updates so onFire flows through the
                                   FAB.
  AlarmsModal.test.tsx           — NEW. Three integration tests: add with
                                   onFire, clear via × on existing row,
                                   prefill round-trip.
  AlarmHostService.test.ts       — adds peer-roundtrip onFire test, update/
                                   clear test, two persistence tests.

packages/app/src/peer/
  protocol.ts                    — alarm-add + alarm-update.patch types
                                   carry optional onFire.
  PeerClientService.ts           — sendAlarmAdd/sendAlarmUpdate signatures.

packages/app/src/screens/
  MainScreen.tsx                 — useMainAlarmsBindings hook;
                                   <MainAlarmsLauncherScope> wraps the
                                   dashboard subtree.
  StationScreen.tsx              — <AlarmsLauncherBridge> wraps the dashboard
                                   subtree, backed by alarmClient.

packages/components/src/
  shared/AlarmsLauncher.tsx      — NEW. Cross-package contract:
                                   AlarmsLauncherProvider + useAlarmsLauncher
                                   hook. Lives here (not in @gonogo/app) to
                                   avoid a circular import.
  ActionGroup/index.tsx          — bell button next to the state pill.
                                   Hidden when launcher context is null or
                                   group.toggle is null.
  index.ts                       — re-exports shared/AlarmsLauncher.

packages/app/src/__tests__/
  action-group.test.tsx          — three new tests for the bell behaviour.
```

## Why the cross-package context split

`@gonogo/components/ActionGroup` needs to open the alarms modal, but the
modal lives in `@gonogo/app`. Importing app from components would be circular.
Solution: define a small launcher contract (`{name?, action} → void`) in
`@gonogo/components/shared/AlarmsLauncher.tsx`, mount the provider in app
where it has access to the AlarmHostService / AlarmClientService and the
ModalProvider. Components only know the contract — they never see the host
or the modal directly. A test that needs to bypass the bell can render
without the provider; the bell hides itself.

## Where to start when something breaks

- **Action group never fires when the alarm fires:** check
  `AlarmHostService.notifyFire` → `dispatchOnFire`. Per-action errors are
  swallowed; if you need to see them, instrument the catch block. Confirm
  the alarm actually has `onFire` populated via the alarms modal row chip.
- **Bell doesn't appear:** check that `<AlarmsLauncherBridge>` (or
  `<MainAlarmsLauncherScope>`) wraps the Dashboard in the relevant screen.
  In tests, render the widget inside an `<AlarmsLauncherProvider launcher={fn}>`.
- **Peer-created alarm has no side effect:** trace `alarm-add` →
  `AlarmPeerBridge.onAlarmAdd` → `host.addAlarm({ onFire })`. The empty-array
  normalisation in `addAlarm` collapses `[]` to `undefined`; if the wire
  carried `[]`, that's intentional ("station explicitly cleared").
- **Alarms modal opens with stale state from a previous bell click:** the
  prefill is consumed in the `useState` initializer (only on mount). Each
  `useModal().open()` mounts a fresh modal instance, so stale state would
  imply the modal isn't unmounting. Check `ModalProvider.close()` flow.

## Out of scope (deferred from the plan)

- Other `AlarmFireAction.kind` cases (`kos`, `log`, `peer-message`) — the
  union is ready for them; each needs its own design pass.
- Reordering attached actions (drag, up/down). Add-order is preserved.
- Action-group dispatch on station-side (executing locally instead of
  round-tripping through the host). Stations don't talk to Telemachus
  directly; the host stays canonical.

## Commits

- `6c81cd6` "Wire onFire into alarms UI: peer protocol, modal editor, ActionGroup bell"
- Predecessor: `6b0cff1` "Alarms can dispatch action groups when they fire"
