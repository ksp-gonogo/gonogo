# GonogoTelemetry — KSP plugin (staging area)

A KSP mod that adds gonogo-specific telemetry keys (tech tree, contracts, building shops, launchpad state) on top of [Telemachus Reborn](https://github.com/TeleIO/Telemachus-1). Registers as an external plugin via Telemachus's `IMinimalTelemachusPlugin` interface so we can iterate on new keys without rebuilding Telemachus itself.

## Status (2026-05-10): handlers migrated to the Telemachus fork

All keys originally registered by this plugin have been **ported into the Telemachus fork** as proper `DataLinkHandler` subclasses with `[TelemetryAPI(...)]` attributes, alongside the stock handlers. See `local_docs/telemachus-fork/Telemachus/src/`:

- `TechTreeDataLinkHandler.cs` — `tech.unlockedIds / unlockedPartCount / affordable / unlock`
- `KscDataLinkHandler.cs` — `kc.scene / partsAvailable / launchSite / padOccupied / padVesselTitle / facilityLevels / crewRoster / savedShips / upgradeFacility`
- `ScienceInstrumentsDataLinkHandler.cs` — `sci.instruments / experimentBreakdown / canTransmitTotal / canRecoverTotal / deploy / transmit / dump / reset`
- `ContractsDataLinkHandler.cs` — `contracts.active / offered / completedRecent / accept / decline / cancel`
- `LaunchDataLinkHandler.cs` — `ksp.launch / recover / revertToEditor`

In production, the fork's `Telemachus.dll` alone serves all these keys. The staging plugin is no longer required — it's kept here as **the staging-area pattern** for any future keys we want to validate quickly before merging into the fork.

If you still have `GonogoTelemetry.dll` installed in your KSP, it's harmless: Telemachus's `KSPAPIBase` consults its built-in handlers before falling through to the plugin manager, so the fork's versions take precedence. You can remove the staging-plugin DLL once you're confident.

## Role in the bigger picture

Per the revised strategy in `local_docs/telemachus_extension_plan.md` (§3, 2026-05-09), production-quality keys destined for upstream live in **the Telemachus fork**, not here — we need to touch core anyway for write-path verbs (contract accept, tech unlock, launch), so the canonical home for shipped features is the fork.

This plugin is the **fast-iteration staging area**: rebuild a small DLL, drop it into `GameData/`, restart KSP. No full Telemachus build cycle. New read-only keys land here first; once they've been validated end-to-end against gonogo's data feed, the implementation migrates into `local_docs/telemachus-fork/Telemachus/src/<area>DataLinkHandler.cs` and gets PR'd back upstream as part of a cohesive batch.

## Status

**Phase 1 — read-only career view.**

Currently registered (see `src/`):

- `tech.unlockedIds` — array of researched tech-tree node ids
- `tech.unlockedPartCount` — number of parts available under current tech
- `tech.affordable` — `[{ id, title, scienceCost }]` for nodes whose prereqs are met AND scienceCost ≤ current science (drives the research-officer pick-list)
- `kc.facilityLevels` — `{ launchPad, runway, vab, sph, mission, tracking, admin, rd, astronaut }`, each `{ level, max }`
- `kc.partsAvailable` — int, parts purchasable under current tech
- `kc.launchSite` — string, active flight's launch site name (empty when not in flight)
- `kc.padOccupied` — bool, true when the active vessel is in `PRELAUNCH` situation
- `kc.padVesselTitle` — string, vessel name when on the pad
- `kc.savedShips` — `[{ name, partCount, totalMass, facility, requiresFunds, missingParts }]` for VAB + SPH .craft files. `requiresFunds` and `missingParts` are stubbed empty until the part-walk lands.
- `kc.crewRoster` — `[{ name, trait, experienceLevel, available, unavailableReason }]`. `unavailableReason` is the raw RosterStatus string for greyed-out tooltips.
- `sci.instruments` — per-vessel `[{ partId, partTitle, expId, deployed, hasData, rerunnable, inoperable }]`.
- `sci.experimentBreakdown` — per-vessel `[{ subjectId, biome, situation, expTitle, dataMits, baseTransmitValue, transmitBonus, subjectScience, subjectScienceCap, remainingPotential }]`.
- `sci.canTransmitTotal` / `sci.canRecoverTotal` — float scalars (sum of `dataAmount`).
- `contracts.active` / `contracts.offered` / `contracts.completedRecent` — `[{ id, title, agency, state, fundsAdvance, fundsCompletion, fundsFailure, scienceCompletion, repCompletion, deadlineUt, parameters: [{ title, state, optional }] }]`. `completedRecent` is capped at the most recent 20.

### Write paths (use Telemachus's bracket-args, e.g. `?a=tech.unlock[advFlightControl]`)

- `tech.unlock[techId]` — purchases a tech node if affordable + prereqs met.
- `contracts.accept[contractId]` / `contracts.decline[contractId]` — both target Offered contracts.
- `sci.deploy[partId]` — runs a `ModuleScienceExperiment` (idempotent for already-deployed instruments).
- `sci.transmit[partId]` — sends the instrument's stored data via the active vessel's transmitter.

All write actions return `0` on success or a short error string on failure. The plugin matches Telemachus's existing action conventions (see `FlightControlHandlers.cs` `IsAction = true` handlers in the fork) so migration into the fork is mechanical.

See `local_docs/telemachus_extension_plan.md` for the full roadmap (launch director write path is the remaining big piece).

## Build

Requires .NET Framework 4.7.2 SDK (or `mono` / `dotnet` with the netfx 4.7.2 reference packs).

```bash
cd mod/GonogoTelemetry
dotnet build -c Release
```

The csproj references KSP / Unity assemblies from `local_docs/telemachus-fork/references/` and the built Telemachus DLL from `local_docs/telemachus-fork/publish/GameData/Telemachus/Plugins/Telemachus.dll`. Build Telemachus first if you haven't:

```bash
cd local_docs/telemachus-fork/Telemachus
dotnet build -c Release
```

## Install into KSP

1. Build Telemachus (above) and install it normally — copy `local_docs/telemachus-fork/publish/GameData/Telemachus/` into `<KSP>/GameData/`.
2. Build this mod (above) and copy the output:

   ```bash
   mkdir -p <KSP>/GameData/GonogoTelemetry/Plugins
   cp bin/Release/net472/GonogoTelemetry.dll <KSP>/GameData/GonogoTelemetry/Plugins/
   ```

3. Launch KSP. Check `<KSP>/Logs/KSP.log` (or the in-game console) for the line:

   ```
   [GonogoTelemetry] Registered with Telemachus.
   ```

## Verify it works

Open `http://<KSP-host>:8085/telemachus/datalink?tech.unlockedIds=tech.unlockedIds` in a browser. Should return JSON like:

```json
{ "tech.unlockedIds": ["start", "basicRocketry", "engineering101"] }
```

Or in gonogo's WS feed, subscribe to `tech.unlockedIds` (or any of the `kc.*` keys) from the Data Source widget — value lands as an array. The built-in `space-center-status` widget consumes `kc.facilityLevels`, `kc.partsAvailable`, `kc.launchSite`, `kc.padOccupied`, and `kc.padVesselTitle` and is the easiest end-to-end smoke test.

## Adding a new key

1. Add the key to the `Commands` array in `TechTreeApi.cs` (or a new file alongside it).
2. Add a `case "..."` branch in `GetAPIHandler` returning a delegate of the form `(vessel, args) => value`.
3. Rebuild + reinstall.

For non-tech keys (contracts, science instruments, etc.), follow the same pattern in a new class implementing `IMinimalTelemachusPlugin` and register it from `GonogoTelemetryAddon.Awake`.

## Why a plugin AND a fork

The plugin gives us a fast iteration loop — `dotnet build` of a ~kilobyte DLL, drop in `GameData/`, restart KSP. The fork gives us the production-quality home for keys we want everyone running Telemachus to be able to use, and is the only place we can add the parameterised `?a=verb&id=...` write-path endpoints needed for Phase 4 (contract accept, tech unlock, `ksp.launch`, `ksp.recover`).

Workflow for a new key:

1. Prototype it in this plugin, behind a new `IMinimalTelemachusPlugin` class or alongside an existing one.
2. Verify end-to-end against gonogo's data feed (subscribe via the Data Source widget; build a consuming widget if one's planned).
3. Migrate the implementation into `local_docs/telemachus-fork/Telemachus/src/<area>DataLinkHandler.cs` — same logic, now using the `[TelemetryAPI]` attribute pattern that the fork's `DataLinkHandler` base class consumes.
4. Once the fork has accumulated a cohesive batch (e.g. all of `tech.*` + `kc.*`), PR it back upstream.

Until upstream-merge, gonogo users install our fork's `Telemachus.dll` plus this plugin's `GonogoTelemetry.dll`. After a merge lands, the migrated keys come from vanilla Telemachus and this plugin contains only whatever's still in flight.
