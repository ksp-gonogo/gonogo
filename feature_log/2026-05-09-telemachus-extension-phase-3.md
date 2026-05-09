# Telemachus extension — Phase 3 (contracts read view)

- **Date:** 2026-05-09
- **Validation:** ⏳ pending — needs a live KSP career save with contracts active and offered. Most uncertain points: the `ContractsFinished` collection name (varies by KSP version — defensive fallback iterates `Contracts` and filters by state), and `Agent.Name` access (which I haven't seen first-hand — `.Title` is also a possibility). Both are guarded with null-checks so the worst case is a blank field, not a crash.
- **Plan:** `local_docs/telemachus_extension_plan.md` §4.3 (gitignored).

## What landed

Career-mode contracts surfaced through the GonogoTelemetry plugin, plus a Mission Director widget consuming the read keys. Style mirrors `ScienceCareerDataLinkHandler` — raw KSP fields go on the wire, derivation lives client-side.

### Mod (`mod/GonogoTelemetry/src/`)

1. **`ContractsApi.cs`** — new `IMinimalTelemachusPlugin` registering three keys:
   - `contracts.active` — array of `[{ id, title, agency, state, fundsAdvance, fundsCompletion, fundsFailure, scienceCompletion, repCompletion, deadlineUt, parameters: [{ title, state, optional }] }]`. One entry per `Contract` whose `ContractState == Active`.
   - `contracts.offered` — same shape, `ContractState == Offered` (waiting in Mission Control).
   - `contracts.completedRecent` — same shape, the last 20 finished contracts (`Completed` or `Failed`), newest-first by `DateFinished`. Capped server-side to keep the WS payload small in long careers.
2. **Style decisions, deliberate:**
   - No client-side derivation of "time until deadline" — the wire carries raw `deadlineUt` and the widget combines it with `t.universalTime`, the same way `ScienceCareerDataLinkHandler` surfaces `subjectID` raw.
   - Parameter state surfaced as the raw enum string (`Incomplete` / `Complete` / `Failed`); the widget collapses unknowns to `Incomplete` defensively.
   - One handler per topic (`tech`, `kc`, `sci`, `contracts`) instead of a single mega-handler — easier to migrate piecewise into separate `*DataLinkHandler.cs` files in the fork.
3. **`GonogoTelemetryAddon.TryRegister`** — registers `ContractsApi` alongside `TechTreeApi`, `KscApi`, `ScienceApi`.

### App-side widget (`packages/components/src/MissionDirector/`)

New built-in component, id `mission-director`. Read-only Phase 3:

- Subtitle counts: `N active · M offered · K recent`.
- One card per active contract: title + deadline-countdown, agency, reward chips (FUNDS / SCI / REP — only shown when non-zero), parameter checklist with state-based marks (`✓` complete, `✕` failed, `○` incomplete) and styling (line-through on complete, danger-red on failed).
- `formatDeadline` helper handles stock-Kerbin time conversion (6h day / 426d year). Below an hour, falls back to minutes.
- 8 unit tests — 4 widget + 3 parser + 5 formatter.
- `dataRequirements`: `contracts.active`, `contracts.offered`, `contracts.completedRecent`, `t.universalTime`.

## Key contracts (don't break these)

- **Wire shape mirrors KSP `Contract` directly.** Don't add derived fields server-side ("daysRemaining" etc.) — keep the staging plugin compatible with a 1:1 migration into a new `ContractsDataLinkHandler.cs` in the fork.
- **`completedRecent` is capped at 20** in the plugin (`RECENT_LIMIT`). A long career has hundreds of finished contracts; surfacing them all would push a multi-MB blob through the WS every poll. If a future widget needs more history, paginate rather than uncap.
- **Parameter `state` is the raw KSP enum string.** The widget tolerates unknown values by collapsing to `Incomplete`. If KSP ever adds a fourth state, the wire will pass it through; the widget surfaces it as not-yet-done rather than silently ignoring.

## File map

```
mod/GonogoTelemetry/
  src/ContractsApi.cs           — NEW
  src/GonogoTelemetryAddon.cs   — registers ContractsApi alongside the rest

packages/components/src/MissionDirector/
  index.tsx                     — NEW. parseContracts + formatDeadline +
                                  MissionDirectorComponent
  index.test.tsx                — NEW. 12 tests across widget / parser / formatter
packages/components/src/index.ts — exports MissionDirector
```

## Where to start when something breaks

- **`contracts.active` empty in a save with active contracts:** check `ContractSystem.Instance.Contracts` via the in-game console — the iterator may return fewer entries than expected if a mod (Strategia, Contract Configurator) reroutes contracts through its own list. Plugin reads stock; document the gap and extend if needed.
- **Agency shows blank:** `Contract.Agent.Name` may be absent or differently-named on this KSP version. The widget treats empty as "hide the row"; falling back to `c.Agent?.Title` is the next thing to try.
- **`completedRecent` empty after finishing a contract:** `ContractSystem.ContractsFinished` exists in most versions but isn't guaranteed. The handler has a fallback that iterates `Contracts` and filters by state — if both come back empty, KSP may not be tracking finished contracts in this build.
- **Deadline shows "no deadline" for a contract that *does* have one:** `Contract.DateExpire` is in UT seconds; zero means "no expiry" (the most common case, e.g. the welcome contracts). The widget treats zero / negative as "no deadline" — this is correct for those, not a bug.

## Out of scope (deferred)

- **Contract accept / decline** — Phase 4 (write paths). The widget is read-only; no accept-from-offered or decline buttons.
- **Notes/Objectives widget (§5 of the plan).** Not started — would auto-populate from `contracts.active` parameters once the templating engine lands. Independent enough to ship later.
- **Strategia / Contract Configurator integrations.** Both rewrite contract parameters; the plugin reads stock fields only. Mod-specific extensions are their own handler.

## Migration prerequisites (before fork merge)

None new — the handler structure was written explicitly to match `ScienceCareerDataLinkHandler` so it can drop into `Telemachus/src/ContractsDataLinkHandler.cs` with mechanical changes (`IMinimalTelemachusPlugin` → `DataLinkHandler` base class, `[TelemetryAPI]` attributes per method).

## Commits

- (uncommitted at time of writing — this entry will be updated on commit)
- Predecessors: `7515638` (Phase 1), `2394cc6` (Phase 2)
