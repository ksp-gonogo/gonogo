# Telemachus extension — Phase 4 slice 1 (write paths)

- **Date:** 2026-05-09
- **Validation:** ⏳ pending — needs a live KSP career save. Write paths are the riskiest part of the extension; my best guesses at the KSP API surface for `Contract.Accept` / `Contract.Decline`, `RDTech.UnlockTech` + `ResearchAndDevelopment.AddScience` ordering, and `ModuleScienceExperiment.DeployExperiment` / `TransmitData` may need adjustment after first contact. Each handler returns a short error string on failure so verification is "click the button, watch the response", not "stare at the KSP console".
- **Plan:** `local_docs/telemachus_extension_plan.md` §4.1 / §4.2 / §4.3 (gitignored).

## Strategic note

The plan claimed Phase 4 had to land in the Telemachus fork because "write verbs touch the HTTP dispatcher". Reading `APIRouteResponsibility.cs:48-58` and `FlightControlHandlers.cs` (`ds.args[0]` etc.) showed that's wrong: Telemachus already supports parameterised actions via `key[arg1,arg2]`. Plugins receive the args via `IMinimalTelemachusPlugin`'s `(Vessel, string[]) => object` handler. **Phase 4 stays in the staging plugin**, same migration path as the read keys.

## What landed (slice 1 of N)

Write paths for tech / contracts / science — the smallest valuable cut. Launch director (`ksp.launch` / `ksp.recover` / `ksp.revertToEditor`) is a separate slice with its own scoping (saved-ships filtering, scene-transition state machine, crew picker UX) and is intentionally out of scope here.

### Mod (`mod/GonogoTelemetry/src/`)

1. **`tech.unlock[techId]`** in `TechTreeApi.cs` — finds the `RDTech` by id, refuses if already-unlocked / unknown / unaffordable, then calls `AddScience(-cost, RnDTechResearch)` followed by `UnlockTech(true)`. Returns `0` on success or a short string on error. Order (deduct then unlock) is best-effort against KSP version drift; if the live verify shows science isn't being charged, swap the order.
2. **`contracts.accept[id]` / `contracts.decline[id]`** in `ContractsApi.cs` — both target `Offered` contracts; `accept` is idempotent against an already-`Active` contract (so a double-click doesn't surface as an error), `decline` is strict (only meaningful on Offered — declining an Active contract is a different verb, `Cancel`, intentionally not exposed in this slice). Long contract id parsed from `args[0]`.
3. **`sci.deploy[partId]` / `sci.transmit[partId]`** in `ScienceApi.cs` — locate the `ModuleScienceExperiment` on the active vessel by `Part.flightID`, refuse on inoperable; deploy is idempotent against already-deployed; transmit refuses when there's no stored data. KSP picks the active transmitter for us rather than us choosing.

All handlers follow Telemachus's `args[0]` convention (see `FlightControlHandlers.cs`) and return `0` / short-string per the established `IsAction = true` pattern. Migration into the fork is mechanical.

### Widgets

- **Mission Director** — offered contracts now render as a separate section after active. Per offered card: `Accept` button (no arm — accepting is reversible by declining) + `Decline` button (arm-then-confirm — declining is irreversible, contract gone). Auto-disarm at `ARM_TIMEOUT_MS = 4000ms` so a forgotten arm doesn't sit waiting for a misclick.
- **Science Officer** — per-instrument controls in the row. `Deploy` (no arm — running an experiment is reversible on rerunnable instruments) when not deployed and no data yet. `Transmit` (arm-then-confirm — transmitting consumes data on one-shot instruments and drains EC) when there's stored data. Hidden entirely on `inoperable` — the badge already explains why.

### Arm-toggle UX rule (defaulted)

Per the user's earlier "decide per-widget later", I went with: **arm-toggle on irreversible writes**. Decline (gone for good), Transmit (consumes data on one-shot instruments). No-arm on reversible writes: Accept (you can decline after), Deploy (rerunnable). Tech unlock isn't yet wired into a widget — defer the UX call until a research-officer widget lands.

This matches the maneuver-trigger arm-cancel pattern; if the user wants a different rule (e.g. arm everything, or arm nothing), the per-button structure makes it easy to flip later.

## File map

```
mod/GonogoTelemetry/
  src/TechTreeApi.cs        — adds tech.unlock action
  src/ContractsApi.cs       — adds contracts.accept / contracts.decline
  src/ScienceApi.cs         — adds sci.deploy / sci.transmit
  README.md                 — documents the new write paths

packages/components/src/MissionDirector/
  index.tsx                 — Offered section, AcceptButton, DeclineButton
                              (arm-then-confirm)
  index.test.tsx            — adds 2 wiring tests
packages/components/src/ScienceOfficer/
  index.tsx                 — InstrumentActions per row, arm-then-confirm
                              for transmit
  index.test.tsx            — adds 3 wiring tests
```

## Key contracts (don't break these)

- **Action keys use bracket-args, not query-string args.** `contracts.accept[42]`, not `?a=contracts.accept&id=42`. Telemachus's existing `APIRouteResponsibility` converts both forms but bracket-args is what `IMinimalTelemachusPlugin.GetAPIHandler` sees, and it's the convention `FlightControlHandlers` uses. Wire format consistent across reads and writes.
- **Empty / missing args return a short error string, not throw.** Telemachus packages return values into JSON; throwing surfaces as a 500 from `APIRouteResponsibility`. Returning a string ("missing contract id") makes the failure debuggable from the browser.
- **Idempotent verbs are explicitly idempotent.** `contracts.accept` on an already-Active contract returns 0 (success). `sci.deploy` on an already-deployed experiment returns 0. Don't change to error-on-duplicate without a UX reason — duplicate clicks are normal in laggy multi-screen sessions.
- **Decline only targets Offered.** Cancelling an Active contract uses `Contract.Cancel`, not `Contract.Decline`. Keep them separate so the widget doesn't silently abandon active work when the operator hits decline on an active card. Active cards in this slice intentionally have *no* action buttons.
- **Arm-then-confirm uses local state, no central registry.** Each button manages its own `armed` state with auto-disarm. Don't centralise into a global "armed-actions" store unless we need cross-widget coordination — that complicated the maneuver-trigger story without payoff.

## Where to start when something breaks

- **`tech.unlock[id]` returns "unlock failed":** the `AddScience` / `UnlockTech` ordering is the most likely culprit. Try reversing them (unlock first, deduct second) — different KSP versions handle the auto-charge in `UnlockTech` differently. If that doesn't help, instrument with `Debug.Log` inside the success branch to see whether `target.UnlockTech(true)` returned true.
- **`contracts.decline[id]` reports "contract not in Offered state":** check the contract's actual state via `contracts.active` / `contracts.offered` — the widget might be showing a stale snapshot from before the operator already accepted it elsewhere.
- **`sci.transmit[partId]` says "no data to transmit" but the badge said DATA:** the data was probably collected under a different module on the same part (e.g. a Mystery Goo with two ScienceData entries from different deploys). The handler reads only the `ModuleScienceExperiment` data; future enhancement: fall back to `IScienceDataContainer.GetData` from the part's other modules.
- **Button is disabled / missing on the widget:** `inoperable` hides Science Officer controls entirely; only `Offered` contracts get accept/decline buttons. If the underlying state looks right but UI is wrong, check the parser fallbacks in `parseInstruments` / `parseContracts`.

## Out of scope (this slice)

- **Launch director** — `ksp.launch[shipName,facility,site,crew]` / `ksp.recover` / `ksp.revertToEditor`. Has its own scoping (saved-ships affordability filter, kerbal availability, scene-transition state machine: armed → launching → loaded). Separate slice.
- **Research officer widget** — `tech.unlock` is exposed as an action but no widget consumes it yet. The Space Center Status widget is the natural home (it already shows facility levels and parts available); a follow-up can add a "spend N to unlock X" button, with arm-toggle since unlock is irreversible.
- **Cancel an Active contract** (`Contract.Cancel`). Different verb, different UX (active contract has work-in-progress; cancel forfeits it). Add only if requested.
- **Deploy options for `ModuleScienceExperiment` subclasses** (DMagic, Bluedog). Plugin reads stock fields only.

## Migration prerequisites (before fork merge)

Same handler structure as the read keys; nothing new to clean up. The `tech.unlock` + `AddScience` ordering should be verified live before migration, but that's a correctness concern, not a stylistic one.

## Commits

- (uncommitted at time of writing — this entry will be updated on commit)
- Predecessors: `7515638` (Phase 1), `2394cc6` (Phase 2), `127ddf4` (Phase 3)
