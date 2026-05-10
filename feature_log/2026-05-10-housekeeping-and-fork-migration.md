# Telemachus extension — housekeeping + fork migration

- **Date:** 2026-05-10
- **Validation:** ✅ confirmed for the 2026-05-09 phases (live in-game playtest validated tech / contracts / sci / kc / facility upgrade write paths). Fork-migrated handlers are ⏳ pending live exercise on the next KSP boot — they were built (compiled clean), installed (`Telemachus.dll` 1041 KB now in `kspdata/GameData/Telemachus/Plugins/`), and review-checked but not curl-tested through the new code path yet.
- **Plan:** `local_docs/telemachus_extension_plan.md` §3 (the strategic-fork move).

## Story

Two-part overnight session: housekeeping fixes that surfaced during the live playtest, then the §3 strategic-fork migration the plan called for from the start.

## Housekeeping (in `mod/GonogoTelemetry/src/`)

1. **`ksp.launch` active-vessel safety check.** The first launch attempt succeeded but wedged KSP in a frozen Flight scene with maxed-out UT counters. Cause: the user had returned to SC after a prior flight that hadn't been recovered, so `FlightGlobals.ActiveVessel` was non-null when `StartWithNewLaunch` fired. KSP doesn't handle that gracefully. Plugin now refuses with `"active vessel exists — recover or revert before launching"`.
2. **Non-dialog `sci.deploy`.** Default `ModuleScienceExperiment.DeployExperiment()` calls the private coroutine `gatherData(showDialog: true)`, which spawns the result dialog. Stations / dashboards aren't sitting at the keyboard; the dialog is friction. Reach the same coroutine with `showDialog: false` via reflection (the path KSP itself uses for EVA-deploy). Falls back to the public dialog path if reflection fails (KSP version drift).
3. **Float rounding.** `Util.R4(value)` helper rounds to 4dp at emission. KSP's float-internal storage caused noisy serialised values like `totalMass: 0.0400000018998981` and `requiresFunds: 612.000000476837`. Applied at every numeric emit in `KscApi`, `ScienceApi`, `ContractsApi`.
4. **Sticky cache for `tech.*` reads.** During scene transitions, KSP clears `ResearchAndDevelopment.Instance.protoTechNodes` and rebuilds it from the save — there's a one-frame window where `GetTechnologyState` returns Unavailable for every node. Detection: `start` is always Available in any career save; if it isn't, we're mid-load. Substitute the previously-cached result for that window. Affects `tech.unlockedIds` and `tech.affordable`.

All four landed in commit `[pending]` along with the migration. Built, installed, ready for the next KSP boot to verify.

## Fork migration (in `local_docs/telemachus-fork/Telemachus/src/`)

The original plan (§3, 2026-05-09 revision) called for "fork-with-intent-to-merge": prove keys in the staging plugin, migrate to the fork once stable, eventually upstream. Tonight's playtest confirmed every key works end-to-end, so the migration is unblocked.

Five new files in the fork, replacing the staging plugin's `<X>Api.cs`:

- `TechTreeDataLinkHandler.cs` — `tech.unlockedIds`, `tech.unlockedPartCount`, `tech.affordable`, `tech.unlock`. AlwaysEvaluable on the reads.
- `KscDataLinkHandler.cs` — `kc.scene`, `kc.partsAvailable`, `kc.launchSite`, `kc.padOccupied`, `kc.padVesselTitle`, `kc.facilityLevels`, `kc.crewRoster`, `kc.savedShips`, `kc.upgradeFacility`.
- `ScienceInstrumentsDataLinkHandler.cs` — `sci.instruments`, `sci.experimentBreakdown`, `sci.canTransmitTotal`, `sci.canRecoverTotal`, `sci.deploy`, `sci.transmit`, `sci.dump`, `sci.reset`.
- `ContractsDataLinkHandler.cs` — `contracts.active`, `contracts.offered`, `contracts.completedRecent`, `contracts.accept`, `contracts.decline`, `contracts.cancel`.
- `LaunchDataLinkHandler.cs` — `ksp.launch`, `ksp.recover`, `ksp.revertToEditor`.

Wired into `KSPAPIBase.cs` constructor alongside the stock handlers.

### Pattern conversions

The `IMinimalTelemachusPlugin` interface (`Commands` array + `GetAPIHandler` switch) becomes the fork's `[TelemetryAPI(...)]` attribute pattern matching `ScienceCareerDataLinkHandler.cs`. Method signatures change from `(Vessel, string[]) => object` to `object Method(DataSources ds)` accessing `ds.vessel` and `ds.args` (which is an `IList<string>`, not `string[]`).

Critically: the fork's `DataLinkHandler` base class auto-wraps any `IsAction = true` method in `queueDelayed`, which routes through `TelemachusBehaviour.instance.BroadcastMessage("queueDelayedAPI", ...)`. That replaces our hand-rolled `GonogoTelemetryAddon.Defer(...)` queue. Net effect: write actions are guaranteed to run on the main Unity thread by construction — no per-handler ceremony, no `DontDestroyOnLoad` hack.

The handlers also use `AlwaysEvaluable = true` on global read keys (kc.scene, contracts.*, tech.*, etc.) so they reach the operator outside Flight without our `KSPAPIBase.cs` plugin-lookup-before-flight-gate patch needing to do the work for them — the existing `apiEntry.alwaysEvaluable` path covers it natively.

### Three fork patches still apply

These were necessary fixes from the staging-plugin attempt, useful regardless:

1. `PluginRegistration.cs:19` — `public static class` (the staging-plugin pattern needed it; future external plugins still benefit).
2. `Properties/AssemblyInfo.cs` — `[KSPAssembly("Telemachus", 1, 7)]` self-identification (any plugin declaring a load-order dep against Telemachus needs this to resolve).
3. `KSPAPIBase.cs` — plugin lookup before flight gate (still useful for any external plugin that registers scene-agnostic keys via the `IMinimalTelemachusPlugin` route).

All three are upstream-PR worthy independent of the migration.

### Float rounding inlined per handler

The fork doesn't have a central rounding helper, so each migrated handler defines its own private `R4(double v)` static. Consistent value across the five files. Kept private to avoid polluting the fork's public surface — easy to extract to a shared `Util` if a future PR wants it.

## Compatibility

The fork's built-in handler dispatch in `KSPAPIBase.ProcessAPIString` consults `APIHandlers` (built-in) before falling through to the plugin manager. So with both `Telemachus.dll` (migrated) and `GonogoTelemetry.dll` (staging plugin) installed, the fork's versions take precedence — the plugin's identical-named handlers register but are unreachable. No conflict, no duplicate dispatch.

The user can remove `GonogoTelemetry.dll` whenever convenient — the plugin's role is now purely "staging area for future keys" per the §3 plan.

## File map

```
mod/GonogoTelemetry/
  src/Util.cs                — NEW. R4(double) + R4(float) rounding helpers
  src/KscApi.cs              — float rounding applied
  src/ScienceApi.cs          — float rounding + non-dialog sci.deploy via reflection + sci.dump / sci.reset (already added 2026-05-09)
  src/ContractsApi.cs        — float rounding
  src/TechTreeApi.cs         — sticky cache + IsTransientLoadingState
  src/LaunchApi.cs           — ActiveVessel safety check
  README.md                  — notes the fork migration

local_docs/telemachus-fork/Telemachus/src/
  TechTreeDataLinkHandler.cs           — NEW (gitignored)
  KscDataLinkHandler.cs                 — NEW (gitignored)
  ScienceInstrumentsDataLinkHandler.cs  — NEW (gitignored)
  ContractsDataLinkHandler.cs           — NEW (gitignored)
  LaunchDataLinkHandler.cs              — NEW (gitignored)
  KSPAPIBase.cs                         — wires all five into APIHandlers (gitignored)
```

## Outstanding (small, non-blockers)

- **Live verification of the migrated path.** KSP must be restarted (with the new `Telemachus.dll` already installed) and the curl battery re-run. Each key should still return the same shape, but now via the fork's dispatch instead of the plugin's. Once confirmed, this entry promotes to ✅ confirmed.
- **Remove `GonogoTelemetry.dll` from kspdata.** Optional cleanup. Not required (no conflict), but tidier.
- **Upstream PR.** The three fork patches + five new handler files form a cohesive batch. Worth a focused human pass before submitting.
- **Removed plugin's `KSPAssemblyDependency` becomes dead weight.** If we drop the staging plugin entirely, the `[KSPAssemblyDependency("Telemachus", 1, 7)]` and `[KSPAssembly("GonogoTelemetry", 0, 1)]` attributes in `mod/GonogoTelemetry/Properties/AssemblyInfo.cs` are no longer necessary. Leave them — they document the pattern for future staging-plugin authors.

## Commits

- (uncommitted at time of writing — entry will be updated on commit)
- Predecessors: `9b8a858` (live-fixes), `0d14cdc` (API corrections), `e992bd8`+`2fcffcd`+`127ddf4`+`2394cc6`+`7515638` (the original staging-plugin phases now superseded by the fork handlers).
