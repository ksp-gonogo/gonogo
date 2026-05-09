# Telemachus extension — Phase 4 slice 2 (launch director)

- **Date:** 2026-05-09
- **Validation:** ⏳ pending — needs a live KSP career save. Highest-risk areas: the `VesselCrewManifest.FromConfigNode` + `AddCrewToSeat` API surface (varies by KSP version), the `GameEvents.onVesselRecoveryRequested` vs `OnVesselRecoveryRequested` casing fallback, and whether `FlightDriver.StartWithNewLaunch` accepts a null `flagURL`. The `kc.savedShips` part-walk is best-effort but should be solid for stock parts; modded parts may show as missing if their `AvailablePart.name` doesn't match the .craft `name` field cleanly.
- **Plan:** `local_docs/telemachus_extension_plan.md` §4.5.

## What landed

The headline Phase 4 piece — pick a saved craft and crew, fire `ksp.launch` from a station. Plus the `kc.savedShips` part-walk that unstubs Phase 1's affordability + tech-availability flags so the launch director can filter craft.

### Mod (`mod/GonogoTelemetry/src/`)

1. **`KscApi.SavedShips` part-walk.** Replaces the stubbed `requiresFunds = 0 / missingParts = []` from Phase 1. For each `<PART>` in the .craft:
   - Strip the trailing `_<flightId>` suffix from the name field (only when the suffix is all-digits — preserves modded part names that legitimately contain underscores).
   - Resolve `AvailablePart` by name from `PartLoader.LoadedPartsList`. Unknown names → added to `missingParts`.
   - Sum `AvailablePart.cost` into `requiresFunds`. Add `!ResearchAndDevelopment.PartTechAvailable(part)` parts to `missingParts`.
   - Walk `RESOURCE` subnodes: add `amount * density` to `totalMass`, `amount * unitCost` to `requiresFunds` (via `PartResourceLibrary.Instance.GetDefinition`).
   - Wraps the whole walk in a try/catch so a malformed .craft surfaces the file with whatever was parsed rather than dropping it entirely.
2. **`LaunchApi.cs`** — three new actions:
   - `ksp.launch[shipName,facility,site,crewSemicolons]` — locates the .craft, builds a `VesselCrewManifest` with the named crew assigned to seats (skips kerbals not in `RosterStatus.Available`), defers `FlightDriver.StartWithNewLaunch` onto the main thread. `crewSemicolons` is `;`-separated because Telemachus action args are split on commas. Empty crew → unmanned launch.
   - `ksp.recover` — refuses unless vessel is `PRELAUNCH / LANDED / SPLASHED`; fires `GameEvents.onVesselRecoveryRequested.Fire(vessel)` with a fallback to `OnVesselRecoveryRequested.Fire(protoVessel)` for older KSP builds.
   - `ksp.revertToEditor[vab|sph]` — refuses unless in flight; defers `FlightDriver.RevertToPrelaunch(EditorFacility.VAB|SPH)`.
   - All three reject loudly when the scene isn't right ("not in a launchable scene", "not in flight") rather than silently no-op.
3. **`GonogoTelemetryAddon.Defer(Action)`** — main-thread deferred-action queue, drained on `Update()`. Mirrors what Telemachus does internally with `queueDelayed`. Action handlers (which run on the WS listener thread) enqueue scene-transition delegates; the MonoBehaviour drains them on the next Unity tick. Locked queue, exception-isolated invocation.
4. **`GonogoTelemetryAddon.TryRegister`** — registers `LaunchApi` alongside the other handlers.

### App-side widget (`packages/components/src/LaunchDirector/`)

New built-in component, id `launch-director`. Read-write Phase 4:

- **No vessel on pad:** lists saved craft. Each row shows facility · partCount · totalMass + cost tag (or "N locked" when missing parts). Blocked craft (insufficient funds, missing tech) are greyed out and unclickable. Clicking a craft selects it and reveals the crew picker.
- **Crew picker:** chip per kerbal showing trait + experience level. Unavailable kerbals are greyed (40% opacity), tooltips carry the `unavailableReason` string. Multi-select toggles each kerbal in/out of the launch manifest.
- **Launch button:** `Launch <name> (N crew)` / `Launch <name> unmanned`. Arm-then-confirm; auto-disarms after 4s.
- **Vessel on pad:** swap the saved-craft list for a Recover / Revert-to-VAB pair. Both arm-then-confirm. (Recover is irreversible — vessel destroyed; Revert discards in-progress flight state.)
- **Subtitle:** `On pad: <name>` when occupied, `<launchable>/<total> ready · <site>` when picking. Same role-aware-status pattern as Mission Director.
- 8 unit tests across widget + parsers.

### Arm-toggle convention extended

Phase 4 slice 1 set the rule "arm-toggle on irreversible writes". Slice 2 applies it consistently: launch (loads scene, can't undo without revert), recover (vessel destroyed), revert (in-progress flight state lost) — all three armed. Auto-disarm ARM_TIMEOUT_MS = 4000ms matches the Mission Director / Science Officer cadence.

## File map

```
mod/GonogoTelemetry/
  src/KscApi.cs                 — SavedShips replaces stubbed values with
                                  full PART-walk (cost + missingParts +
                                  resource mass / cost)
  src/LaunchApi.cs              — NEW. ksp.launch / ksp.recover /
                                  ksp.revertToEditor
  src/GonogoTelemetryAddon.cs   — Defer(Action) queue drained on Update;
                                  registers LaunchApi alongside the rest

packages/components/src/LaunchDirector/
  index.tsx                     — NEW. parseSavedShips, parseCrew,
                                  LaunchDirectorComponent
  index.test.tsx                — NEW. 8 tests across widget + parsers
packages/components/src/index.ts — exports LaunchDirector
```

## Key contracts (don't break these)

- **Crew arg uses semicolons, not commas.** Telemachus splits action args on commas inside `[…]`, so `ksp.launch[Mun Hopper,VAB,LaunchPad,Jeb;Bill;Bob]` → `args = ["Mun Hopper", "VAB", "LaunchPad", "Jeb;Bill;Bob"]`. The plugin splits the crew arg on `;`.
- **Defer queue isn't optional.** `FlightDriver.StartWithNewLaunch` and `FlightDriver.RevertToPrelaunch` will *crash* (or behave unpredictably) when called from the WS listener thread. New scene-transition actions MUST go through `GonogoTelemetryAddon.Defer`. Telemachus's own action handlers (`NavigationHandlers.cs`) use the same pattern via `queueDelayed`.
- **Refuse, don't silently no-op.** Each action returns a short error string when the scene/state is wrong (`"not in a launchable scene"`, `"vessel not in a recoverable state"`). Surfacing these to the operator is more useful than a silent no-op that looks like the click didn't register.
- **Greyed crew chips ignore clicks.** Don't change the disabled handling to "fire anyway" — kerbals that aren't `Available` shouldn't end up on a launch manifest, KSP will refuse them, and the UI's `selectedCrew` set would drift out of sync with what KSP actually accepted.
- **Saved craft filtering happens client-side.** The plugin emits all saved craft regardless of affordability or tech; the widget filters via `requiresFunds <= career.funds && missingParts.length === 0`. This keeps the wire format consistent (a research-officer widget could display the locked craft to nudge what to unlock) while the launch director's UX is "only show what I can fly".

## Where to start when something breaks

- **Launch button fires but nothing happens in KSP:** check `KSP.log` for the deferred-action stack trace; the most likely culprit is `FlightDriver.StartWithNewLaunch` rejecting the manifest (seat assignment off, malformed crew name) or the craft path (the .craft file got moved). The `Defer` queue's exception logging surfaces these as `[GonogoTelemetry] Deferred action threw: …`.
- **Crew always shown unavailable despite the kerbal being free in-game:** `kc.crewRoster` reads `kerbal.rosterStatus`; if Mission Control / Astronaut Complex is showing them differently, the in-game roster cache may need a refresh (entering and leaving the AC scene usually does it).
- **Recover button surfaces "vessel not in a recoverable state" on the pad:** `vessel.situation == PRELAUNCH` is what we check. If KSP reports a different situation immediately after launch (e.g. `LANDED` for a wheels-on-ground rover), recover should still work — the check explicitly allows LANDED + SPLASHED.
- **Saved craft list is empty in a new save:** save folder might not have created the `Ships/VAB/` directory yet (KSP creates these lazily on first VAB save). Confirm `<save>/Ships/VAB/*.craft` exists before debugging the plugin path.

## Out of scope (deferred)

- **Editor-aware revert.** Phase 4 slice 2 hardcodes the revert target to VAB. The plugin accepts `vab|sph`; the widget could remember which editor the active vessel came from (via the .craft `facility = SPH` field?) and pick the right one. Defer to a follow-up.
- **Scene-transition state machine on the widget side.** Right now the launch button fires and the widget waits for `kc.padOccupied` / `padVesselTitle` to flip via the regular telemetry. A proper "launching → loaded" intermediate state (with a spinner) would be nicer when KSP is paused mid-load — defer.
- **Research officer widget.** `tech.unlock` exposed as an action since Phase 4 slice 1 but no widget hosts it. Space Center Status is the natural home; a "spend N to unlock X" arm-toggle button would close that loop.
- **Cancel an Active contract** (`Contract.Cancel`). Different verb from decline.

## Migration prerequisites (before fork merge)

The deferred-action queue (`GonogoTelemetryAddon.Defer`) is plugin-specific machinery; the fork has its own `queueDelayed` infrastructure. Migration substitutes one for the other — handler bodies stay the same.

## Commits

- (uncommitted at time of writing — this entry will be updated on commit)
- Predecessors: `7515638` (Phase 1), `2394cc6` (Phase 2), `127ddf4` (Phase 3), `2fcffcd` (Phase 4 slice 1)
