# Mission Director cancel + contract-parameter alarms + scene banner

- **Date:** 2026-05-09
- **Commit:** `5ca10d8`
- **Validation:** ⏳ pending — landed and tested in CI; not yet exercised in a live KSP session.

## Story

Three loosely-related additions bundled because they all hang off the existing Mission Director / alarm surface. Written retroactively from the commit; the work itself shipped during the 2026-05-09 Telemachus-extension push.

## Cancel-contract

- **Plugin (`mod/GonogoTelemetry/src/ContractsApi.cs`):** `contracts.cancel[id]` write action calling `Contract.Cancel()`. Refuses anything not in `Active` state.
- **Widget (`MissionDirector`):** arm-then-confirm Cancel button per active contract card. Sits alongside the existing accept/decline buttons; click once arms, click again confirms.

## Contract-parameter alarm trigger

New `AlarmTrigger` kind `contract-parameter` — a third alarm-system variant alongside the existing `time` and `threshold` triggers. **Schema change** to the alarm persistence shape (and the peer protocol over PeerJS).

Shape:

```ts
{
  kind: "contract-parameter",
  contractId: number,        // stock KSP contract id (safe-integer assumption — see big-id work in 2026-05-11)
  parameterTitle: string,    // human-readable parameter title (matches the displayed contract row)
  targetState: ParameterState, // which state to fire on — typically "Complete"
  matchSinceUT: number,      // standard sustain-style match window
  sustain: number,
}
```

Wiring:

- `AlarmStateMachine` + `AlarmHostService` gained a third evaluator branch that subscribes to `contracts.active`, walks `[].parameters[]`, and matches on `(contractId, parameterTitle)` → state.
- `migrateAlarm` round-trips contract-parameter triggers (so old persisted alarms still load).
- `AlarmsLauncher` contract gained a separate `AlarmCreator<T>` direct-create path — sibling to the existing modal-prefill launcher. Used for the bell-icon flow below.

UI surface:

- `MissionDirector` shows a bell icon next to each `Incomplete` parameter on an Active contract. Click creates the alarm directly (no modal — the contract id + parameter title + targetState=Complete are all known). Sustain defaults to 0 since parameter state is already discrete (you don't need to debounce a `Complete` flag the way you do an altitude crossing).

## Scene-change banner

New `SceneChangeBanner` mounted at `MainScreen` level, alongside the other top-level banners.

- Subscribes to `kc.scene` (the Telemachus-fork-provided key from Phase 1).
- On a real scene change (not the initial WS-warmup arrival), fades a "From → To" label in at top centre for 10s then auto-hides.
- Initial-scene arrival is deliberately suppressed so a fresh page-load doesn't always pop a banner.

## Files

```
mod/GonogoTelemetry/src/ContractsApi.cs                  (contracts.cancel action)
packages/app/src/alarms/AlarmHostService.ts              (contract-parameter evaluator)
packages/app/src/alarms/AlarmStateMachine.ts             (contract-parameter evaluator)
packages/app/src/alarms/AlarmsLauncherBridge.tsx         (direct-create launcher)
packages/app/src/alarms/types.ts                         (ContractParameterTrigger union member)
packages/app/src/components/SceneChangeBanner.tsx        (NEW)
packages/app/src/__tests__/scene-change-banner.test.tsx  (NEW)
packages/app/src/screens/MainScreen.tsx                  (mount banner)
packages/components/src/MissionDirector/index.tsx        (cancel button + parameter bells)
packages/components/src/MissionDirector/index.test.tsx   (covers bell wiring)
packages/components/src/shared/AlarmsLauncher.tsx        (direct-create extension)
```

## Outstanding

- Live verify all three: cancel a contract end-to-end (KSP state changes match the action), create a parameter alarm and watch it fire when KSP marks the parameter complete, observe a real scene transition (e.g. enter Flight from VAB) and confirm the banner fires.
- The `ContractParameterTrigger` discriminated-union narrowing was missing from a handful of consumer sites — that bug fix landed later in `09a9007`. Live alarm rendering should be checked after that fix too.
