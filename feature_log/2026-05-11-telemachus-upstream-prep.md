# Telemachus fork → upstream PR prep

- **Date:** 2026-05-11 (afternoon)
- **Status:** ⏳ in progress — being picked up after a `/compact`
- **User intent (verbatim):** "It's really important that I can see the final set of PRs as drafts as well. Also, it's extra work, but I think if we're doing separate PRs we need to be very careful to ensure that they're all independently appliable."

## Where everything lives

- **Fork source:** `local_docs/telemachus-fork/` (gitignored from gonogo). It IS its own git repo. Upstream is `TelematicusReborn` (the `TeleIO/Telemachus-1` lineage — repo `TelemachusKSP/TelematicusReborn`).
- **Installed DLL** (live in KSP right now): `local_docs/syncthing/kspdata/GameData/Telemachus/Plugins/Telemachus.dll` — most recent build had every fork change baked in and was validated live in this session.
- **Build script:** `./scripts/gonogo_claude_tools.sh build telemachus` (also `tele read/action/subscribe`, `decompile`, `dump`, `findtype`).

## What's been validated live in this session

All confirmed via the live KSP install plus `tele read` / `tele subscribe`:

- CORS allowlist (echoes matched Origin; non-allowed Origin gets no header)
- `recovery.lastSummary` + `recovery.hasRecent` (auto-capture on `onVesselRecoveryProcessingComplete`, no UI click needed)
- `crash.lastCrash` + `crash.hasRecent` (kerbal-kill buffer, live-crew tracker, FlightLogger snapshot embedded)
- `flight.events` + `flight.achievements` (live FlightLogger reads)
- `ksp.revertToLaunch`, `ksp.toSpaceCenter`, `ksp.toTrackingStation`, `ksp.canRevert*`
- `alarm.add` returns uint id sync; `alarm.list` rows include `id`; `alarm.delete[id]` works
- Action gate fix (`DataLinkHandlerBase.cs`: `ActionAPIEntry` ctor now propagates `AlwaysEvaluable`) — tech.unlock / contracts.* / kc.upgradeFacility / ksp.launch all confirmed working outside Flight scene
- Long contract IDs as strings (parser tolerant both ways)
- Type-aware contract parameters (`parameterType` / `minAltitude` / etc.)
- Live WS subscribe with `+` (had been silently broken using `run` until earlier today)

## The PR split (independently applyable)

Order is intentional — earlier PRs are smallest / cleanest / easiest to land. Each must apply to upstream `main` standalone; bundle small shared infra if needed rather than introducing cross-PR ordering.

1. **`telemachus/cors-allowlist`** — `ServerConfiguration.cs` + `TelemachusBehaviour.cs` (read `ALLOWED_ORIGINS`) + `DataLinkResponsibility.cs` (apply header + OPTIONS preflight). Default-off, opt-in via config. Zero behaviour change without explicit config line. Smallest and cleanest.

2. **`telemachus/external-plugin-support`** — three patches that make external plugins workable: `PluginRegistration.cs` → `public static class`, `Properties/AssemblyInfo.cs` → add `[KSPAssembly("Telemachus", 1, 7)]`, `KSPAPIBase.cs` → consult plugin manager before the flight-mode gate. No new keys; pure infra. Independent of every other PR.

3. **`telemachus/action-gate-fix`** — `DataLinkHandlerBase.cs` line ~80: extend `ActionAPIEntry` ctor to accept `alwaysEvaluable` + thread it through from the registration site. **No upstream handler currently combines `IsAction = true` + `AlwaysEvaluable = true`**, so this is a behaviour-preserving enhancement. Prerequisite for PR 6's career-mode actions, but those bundle the same fix to stay standalone.

4. **`telemachus/event-snapshot-handlers`** — `FlightLoggerSnapshot.cs` + `RecoveryDialogHandler.cs` + `CrashDataHandler.cs` + `FlightLogHandler.cs` + `KSPAPIBase.cs` wiring. Read-only event-driven snapshots. Uses the `[KSPAddon]` deferred-subscribe + instance-method-trampoline pattern (KSP's `EvtDelegate.ctor` reads `evt.Target.GetType()` so static handlers NRE). Independent.

5. **`telemachus/alarm-add-delete`** — `AlarmClockHandlers.cs` (alarm.add manually queues to main thread so it can return the new id sync; alarm.delete uses `AlarmClockScenario.DeleteAlarm`) + `DataLinkFormatters.cs` (`AlarmJSONFormatter` includes `Id`). Independent.

6. **`telemachus/career-mode`** — the big one. `TechTreeDataLinkHandler` + `KscDataLinkHandler` + `ScienceInstrumentsDataLinkHandler` + `ContractsDataLinkHandler` (incl. long-id-as-string serialiser + type-aware parameter emit) + `LaunchDataLinkHandler` (launch/recover/revert/revertToLaunch/toSpaceCenter/toTrackingStation/canRevert*) + `ActionGroupBindingsDataLinkHandler` + KSPAPIBase wiring. **Bundles the action gate fix** from PR 3 so it stands alone (identical fix, no conflict if PR 3 also lands).

## The work plan post-/compact

1. **Patch `AfterBuild.sh`** so the `cp -r -R` clash + `authHeader[@]: unbound variable` stop killing the post-build step on macOS. Documented in `local_docs/frozen_bash_commands.md`. ~5 lines.
2. **Ask user to `brew install oven-sh/bun/bun`** (or bypass by reading the generated `Telemachus.Generated.TelemetrySchema.Json` constant directly out of the built DLL and hand-writing the openapi.yaml updates).
3. **Rebuild** end-to-end so `publish/api-schema.json` regenerates with every new key.
4. **Run `tools/generate-openapi.ts`** to refresh `docs/openapi.yaml`. Manual entries in `tools/manual-apis.json` may need additions for keys that aren't auto-extractable.
5. **Update fork `README.md`** — currently has no mention of any new feature.
6. **Confirm fork remote is `TelematicusReborn` or wherever the user wants to PR against.** Check `cd local_docs/telemachus-fork && git remote -v`. The fork may already have a personal GitHub remote configured.
7. **Create 6 branches off whatever the upstream tracking branch is**, cherry-pick the relevant files into each, push as drafts via `gh pr create --draft`. Branch names: as in the section above.
8. **Surface all 6 PR URLs back to the user.**

## Constraints to honour

- **No Co-Authored-By trailers** — repo convention, in CLAUDE.md.
- **Don't push to gonogo's remote** unless asked. (The fork's remote is the upstream target — that one we do push to as drafts.)
- **Each PR independently applyable** — duplicate small shared fixes rather than introduce ordering.
- **Drafts only** — user explicitly wants to review before they merge / un-draft.

## Open questions for post-compact

- Does the fork's git remote already point at the user's personal GitHub fork of `TelematicusReborn`, or does it still point at the original mod? Need to check `git remote -v` before pushing.
- The `tools/manual-apis.json` may have hand-curated entries that don't map 1:1 to my new keys — check whether OPTIONS preflight needs a manual entry, whether the scene-transition actions need anything beyond the source generator's output.

## What NOT to redo

- Don't re-decompile types we've already inspected — the dump cache in `/tmp/gonogo-decompile-cache/` is still warm.
- The DLL currently installed in kspdata (build at ~12:00 today) already contains every change for every PR. No need to rebuild before live verification — only for `publish/api-schema.json` regen.
- gonogo-side commits from earlier today (`7bc8f1c`, `88a2d22`, `e7452a9`, `1dff591`, `09a9007`, `3421f68`, `52fc425`) are landed and don't need touching.
