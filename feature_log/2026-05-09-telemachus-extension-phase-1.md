# Telemachus extension — Phase 1 (read-only career view)

- **Date:** 2026-05-09
- **Validation:** ⏳ pending — needs a live KSP career save. The user can't run the game right now, so this work was built optimistically against the documented KSP API surface (Mono-version idiosyncrasies in `RDTech.parents`, `ScenarioUpgradeableFacilities`, and `ProtoCrewMember.RosterStatus` are flagged in-source as the most likely failure points). Promote to confirmed once subscribing to `tech.affordable` and `kc.facilityLevels` from a live save returns sane values.
- **Plan:** `local_docs/telemachus_extension_plan.md` (gitignored)

## What landed

Phase 1 from the plan — the read-only career view, mod-side keys plus the first consuming widget. Builds on the existing `mod/GonogoTelemetry/` scaffold.

### Mod (`mod/GonogoTelemetry/src/`)

1. **`tech.affordable`** added to `TechTreeApi.cs`. Returns `[{ id, title, scienceCost }]` for nodes whose prereqs are met AND whose cost is ≤ current science. Prereq-walk uses `RDTech.parents[].parent.tech.techID`; the implementation falls back to "no prereq info → treat as met" rather than silently hiding nodes when the predecessor link is shaped differently than expected (the part of the implementation most likely to need a tweak after live verification).
2. **`KscApi.cs`** — new `IMinimalTelemachusPlugin` registering the `kc.*` namespace:
   - `kc.facilityLevels` — dict of nine stock facility ids (`launchPad`, `runway`, `vab`, `sph`, `mission`, `tracking`, `admin`, `rd`, `astronaut`) each `{ level: int, max: int }`. `level` is rounded from the 0..1 value `ScenarioUpgradeableFacilities.GetFacilityLevel` returns. `upgradeFunds` deferred to a follow-up — pulling next-tier cost reliably needs `UpgradeableObject` instances that only exist in the SC scene.
   - `kc.partsAvailable` — int. Same source as `tech.unlockedPartCount`; aliased into `kc.*` so the Space Center widget reads from a coherent namespace.
   - `kc.launchSite` / `kc.padOccupied` / `kc.padVesselTitle` — flight-aware: pad state is `vessel.situation == PRELAUNCH`.
   - `kc.savedShips` — array of `{ name, partCount, totalMass, facility }` for VAB + SPH `.craft` files. Read by enumerating `KSPUtil.ApplicationRootPath/saves/<save>/Ships/{VAB,SPH}/*.craft` and `ConfigNode.Load`-ing each. `requiresFunds` and `missingParts` are stubbed empty until the part-walk lands (Phase 4 launch-director feeder).
   - `kc.crewRoster` — array of `{ name, trait, experienceLevel, available, unavailableReason }`. `unavailableReason` is the raw `RosterStatus` string (`Assigned`, `Missing`, `Dead`, `Hospitalized`) — feeds the greyed-out tooltip UX the user picked for the launch-director crew picker.
3. **`GonogoTelemetryAddon.TryRegister`** — registers `KscApi` alongside `TechTreeApi`. Single try/catch with a latched `registered` flag so a failure logs once and doesn't spam KSP.log.

### App-side widget (`packages/components/src/SpaceCenterStatus/`)

New built-in component, id `space-center-status`. Read-only. Renders:

- A 3-column (2-column when narrow) grid of facility tiers, displayed as `level / (max - 1)` so a tier-3 launchpad reads `2 / 2` (KSP's max count is the tier count *including* tier 0).
- A pad-state subtitle: "On pad: <name>" / "Last site: <site>" / "No vehicle on pad".
- A footer with the parts-available count.
- `dataRequirements` lists every `kc.*` it consumes; `actions: []` (no inputs this phase); `pushable: true`.
- Defensive parser `parseFacilityLevels` exported for unit testing — drops malformed entries, drops unknown facility keys, and accepts a level of 0.
- 7 unit tests via the standard `setupMockDataSource` fixture; the full `@gonogo/components` suite (268 tests) still passes.

### README

`mod/GonogoTelemetry/README.md` reframed: the plugin is now described as a **fast-iteration staging area** for keys destined for the Telemachus fork (per the revised 2026-05-09 strategy in §3 of the plan), not a permanent alternative to forking. Workflow section explains the "prototype here → migrate to fork → upstream" loop. Verification step now points at the new `space-center-status` widget as the easiest end-to-end smoke test.

## Key contracts (don't break these)

- **`kc.facilityLevels` shape is a dict, not an array.** Keys are the short names (`launchPad`, etc.), not the full KSP facility ids. The widget's `parseFacilityLevels` enforces this via an allowlist.
- **`level` is an integer tier**, not the 0..1 normalised value KSP returns. Conversion happens server-side in `KscApi.FacilityLevels()`. If a future caller wants the raw float, add `levelFraction` rather than changing `level`.
- **Sandbox saves must return `{ level: 0, max: 0 }`** for every facility, not throw. KSP's `ScenarioUpgradeableFacilities.GetFacilityLevel` throws when the upgrade scenario module isn't loaded; the per-facility try/catch swallows it and surfaces zeros so the widget renders an em-dash cell.
- **`kc.savedShips.requiresFunds` and `.missingParts` are stubs.** They're declared in the schema so the launch-director widget can light up incrementally, but the values are 0 / empty until the part-walk that resolves part costs and tech requirements lands.
- **The plugin is the staging area, not the destination.** New shipped features migrate into `local_docs/telemachus-fork/Telemachus/src/<area>DataLinkHandler.cs` once validated. Don't accumulate production-quality logic in `mod/GonogoTelemetry/` long-term.

## File map

```
mod/GonogoTelemetry/
  src/TechTreeApi.cs          — adds tech.affordable + PrereqsMet helper
  src/KscApi.cs               — NEW. kc.* namespace
  src/GonogoTelemetryAddon.cs — registers KscApi alongside TechTreeApi
  README.md                   — reframed as staging area for the fork

packages/components/src/SpaceCenterStatus/
  index.tsx                   — NEW. registerComponent, parseFacilityLevels
  index.test.tsx              — NEW. 7 tests (5 widget + 2 parser)
packages/components/src/index.ts — exports SpaceCenterStatus

local_docs/frozen_bash_commands.md — NEW. Tracks Bash invocations that hung
                                    the tool layer; one entry from this
                                    session.
```

## What's left for Phase 1 (deferred from the plan)

- **Live verification.** The plan's step 1 ("smoke-test the existing scaffold") was skipped this session — the user couldn't run KSP. The `RDTech.parents` walk in `tech.affordable` and the `ScenarioUpgradeableFacilities` + roster reads in `kc.*` are the spots most likely to need an in-game tweak.
- **`kc.facilityLevels.upgradeFunds`.** Surfacing next-tier cost needs `UpgradeableObject` instances; deferred until the read path is verified.
- **`kc.savedShips.requiresFunds` / `.missingParts`.** Need a part-walk over each .craft's PART nodes against `PartLoader.LoadedPartsList` and tech-tree availability. Deferred — launch director (Phase 4) is the consumer that needs them, not the Space Center widget.

## Where to start when something breaks

- **`tech.affordable` returns empty in a live career save with science to spend:** check `PrereqsMet` first — `RDTech.parents` may be a different shape than assumed. The fallback path treats "no prereq info" as met, so an empty result with non-zero science means cost or `state == Available` filtered everything out, not the prereq walk.
- **`kc.facilityLevels` returns all zeros:** likely sandbox or science mode (no `ScenarioUpgradeableFacilities` module). Confirm with `career.mode`; in career mode this would mean the per-facility try/catch is firing — log inside the catch.
- **Space Center widget shows em-dashes despite live data:** widget filters via `parseFacilityLevels` allowlist. New facility keys (modded ones) are dropped. Add to `FACILITIES` table in `SpaceCenterStatus/index.tsx`.

## Commits

- `7515638` "Telemachus extension Phase 1: read-only career view"
