# Telemachus extension — Phase 2 (per-instrument science)

- **Date:** 2026-05-09
- **Validation:** ⏳ pending — needs a live KSP career save with science instruments aboard. The most uncertain bit is the `subjectID` parser in `ScienceApi.ParseSubjectId` — KSP's subject id format is `<expId>@<body><situation><biome>` with no separators, and the heuristic split assumes the situation token sits between body and biome cleanly. Mods that emit non-stock situations will hit the empty-string fallback (which is safe — biome / situation just stay blank).
- **Plan:** `local_docs/telemachus_extension_plan.md` (gitignored), §4.1.

## What landed

Per-instrument science detail beyond the existing `sci.experiments` aggregate, plus a Science Officer widget, plus a ScienceBench upgrade that consumes the richer breakdown when present and falls back to the existing experiments view otherwise.

### Mod (`mod/GonogoTelemetry/src/`)

1. **`ScienceApi.cs`** — new `IMinimalTelemachusPlugin` registering four keys:
   - `sci.instruments` — per-vessel `[{ partId, partTitle, expId, deployed, hasData, rerunnable, inoperable }]` walked from every `ModuleScienceExperiment`. `partId` is `Part.flightID`.
   - `sci.experimentBreakdown` — per-vessel `[{ subjectId, biome, situation, expTitle, dataMits, baseTransmitValue, transmitBonus, subjectScience, subjectScienceCap, remainingPotential }]`. Resolves subject info from `ResearchAndDevelopment.GetSubjectByID`; sandbox saves emit zeros + empty biome/situation. The widget sorts client-side by `remainingPotential` desc.
   - `sci.canTransmitTotal` / `sci.canRecoverTotal` — float scalars summing `data.dataAmount` across all stored ScienceData. Two separate keys in case Phase 4's transmit/recover formulas diverge — for now they're aliases.
2. **`ParseSubjectId` heuristic** — splits the `<body><situation><biome>` tail by searching for known stock situation tokens (`InSpaceLow`, `InSpaceHigh`, `FlyingLow`, `FlyingHigh`, `SrfLanded`, `SrfSplashed`). Unknown situations leave both biome and situation empty rather than guessing wrong.
3. **`GonogoTelemetryAddon.TryRegister`** — registers `ScienceApi` alongside `TechTreeApi` and `KscApi`.

### App-side widgets (`packages/components/src/`)

- **`ScienceOfficer/`** — new built-in component, id `science-officer`. Read-only Phase 2: per-instrument list grouped by `expId`, badges for `DATA` / `DEPLOYED` / `ONE-SHOT` / `INOPERABLE`. Subtitle summarises totals (`X/Y with data · Z deployed [· N inoperable]`). 4 unit tests.
- **`ScienceBench/index.tsx`** — adds `parseExperimentBreakdown` parser + `BreakdownList` subcomponent. When `sci.experimentBreakdown` is present, the Aboard section renders the richer view (subject + biome + dataMits + remaining potential). Otherwise falls back to the existing `sci.experiments` rendering — the widget keeps working for users who haven't installed GonogoTelemetry. 1 new widget test + 3 new parser tests.

## Key contracts (don't break these)

- **Science fields are emitted as raw KSP values, not derived.** Phase 2 deliberately doesn't compute "transmit science gained" or "recover science gained" — the actual KSP formula involves `scienceValueRatio` and transmissibility per-experiment, and getting it wrong silently misleads the operator. The widget displays `dataMits` (raw stored data) and `remainingPotential` (cap - earned). When the formula is verified live we can add derived fields without breaking the wire.
- **Breakdown is opt-in via key presence.** The widget checks `breakdown && breakdown.length > 0`. An empty array (vessel with no stored data) falls back to the legacy view, which renders "No experiments aboard" — same UX whether the plugin is installed or not.
- **`ParseSubjectId` is heuristic.** If a future ask depends on biome/situation being present, *don't* silently rely on this parser — request that the plugin emit them as separate fields server-side (we already pull them from `ScienceSubject` in some spots; we can extend that path).

## File map

```
mod/GonogoTelemetry/
  src/ScienceApi.cs            — NEW. sci.instruments, sci.experimentBreakdown,
                                 sci.canTransmitTotal, sci.canRecoverTotal
  src/GonogoTelemetryAddon.cs  — registers ScienceApi alongside the others

packages/components/src/ScienceOfficer/
  index.tsx                    — NEW. Per-instrument list, grouped by expId
  index.test.tsx               — NEW. 4 widget + 2 parser tests
packages/components/src/ScienceBench/
  index.tsx                    — adds parseExperimentBreakdown + BreakdownList;
                                 Aboard section renders breakdown when present
  index.test.tsx               — adds breakdown widget test + parser tests
packages/components/src/index.ts — exports ScienceOfficer
```

## Where to start when something breaks

- **`sci.instruments` empty in flight with instruments visible:** check `ModuleScienceExperiment` enumeration — some mods (DMagic, Bluedog) wrap their experiments in subclasses that satisfy `is ModuleScienceExperiment` but have non-standard property names. The walk only reads stock fields; mod-specific extensions need their own handler.
- **Breakdown shows blank biome / situation:** `ParseSubjectId` failed. The known situation list in `ScienceApi.cs` is stock-only. Add the modded situation token to `KnownSituations` if needed.
- **ScienceBench shows the legacy view despite the plugin running:** check that `sci.experimentBreakdown` is in the data source schema and being subscribed. The widget reads it via `useDataValue("data", "sci.experimentBreakdown")`; without the plugin, this returns `undefined`, the parser returns `null`, and the conditional falls through.

## Out of scope (deferred to later phases)

- **Deploy / collect / transmit buttons** — Phase 4 (write paths). The Science Officer widget intentionally has `actions: []`. When Phase 4 lands the widget grows per-instrument controls.
- **Computed transmit / recover science** — needs verification against a live save's transmit / recovery dialog. Sketched in `ScienceApi.cs` as `baseTransmitValue` + `transmitBonus`; the widget chooses not to multiply them out yet.
- **Biome / situation from kerbalism / mod overrides** — same fix as the situation tokens: extend the known set if a mod emits new situations.

## Migration prerequisites (before this lands in the Telemachus fork)

Two spots where Phase 2 leans away from Telemachus's "surface raw values" convention. Both fine in the staging plugin; both need a clean-up pass before migration so we don't drag plugin-shaped warts upstream.

- **`ParseSubjectId` heuristic.** Telemachus's existing `ScienceCareerDataLinkHandler` emits `subjectID` raw and lets the client interpret. Either drop `biome` / `situation` from the wire and parse client-side, or extend the upstream handler with the situation-token table baked in.
- **`sci.canTransmitTotal` and `sci.canRecoverTotal` are aliases** of the same `dataAmount` sum, kept as separate keys on the assumption Phase 4's formulas will diverge. If they don't, collapse to one key (or drop in favour of upstream `sci.dataAmount`) before merging.

## Commits

- (uncommitted at time of writing — this entry will be updated on commit)
- Predecessor: `7515638` (Phase 1 — read-only career view)
