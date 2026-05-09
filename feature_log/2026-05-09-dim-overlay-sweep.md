# Dim-overlay sweep — softer dead values

- **Date:** 2026-05-09
- **Validation:** ⏳ pending — needs a live KSP run to see the dim states actually fire (the `kc.scene` plugin key is what flips widgets in/out of live state). The unit tests cover the wrapper logic against fake telemetry, but the visual + integration story is best verified in-app.
- **Plan:** thread of conversation, no doc — user note about softening dead values via the new GonogoTelemetry context keys.

## What landed

User-visible: every widget that depends on a flying vessel (or a career-mode save) now renders normally with a dim layer + small "Vessel in flight required" / "Career or science save required" banner overlaid when the underlying preconditions aren't met. The widget's existing layout + last-good telemetry stays visible underneath — operators see the shape and last-known values dimmed to ~35% opacity rather than the previous mix of zeros, ghost lines, and "—" placeholders.

### Plumbing

1. **Plugin: `kc.scene`** in `KscApi.cs`. Returns one of `Flight / SpaceCenter / Editor / TrackingStation / MainMenu / Other` mapped from `HighLogic.LoadedScene`.
2. **`<DimmedOverlay show message hint>`** primitive in `@gonogo/ui`. When `show=false`, renders children unchanged (no wrapper, no styling drift). When `show=true`, dims children to 35% opacity + saturate(0.5) and floats a centred banner with the message + optional hint. ARIA: banner is `role="status" aria-live="polite"`, dimmed children are `aria-hidden`.
3. **`useGameContext()`** hook in `@gonogo/core`. Bundles `kc.scene`, `kc.padOccupied`, `career.mode` into `{ scene, inFlight, padOccupied, careerMode, isCareerLike, hasGameSignal }`. `hasGameSignal` is the "we have at least one context value" flag — used to suppress the dim until the WS warms up so a page refresh doesn't flash every widget.
4. **`<RequiresGuard requires={...}>`** wrapper in `@gonogo/components/shared/`. Reads `useGameContext()`, picks the first unmet requirement, renders the appropriate `DimmedOverlay`. Used by the dashboard orchestrator at the boundary so per-widget code stays declarative.
5. **`ComponentRequirement` + `ComponentDefinition.requires`** in `@gonogo/core/types`. Closed enum (`"flight" | "career"`) so messages stay coherent. Add new tokens here when a new gate's needed.

### Orchestrator wires

Three entry points get the wrap:

- **`packages/app/src/components/Dashboard/GridItemContent.tsx`** (desktop grid)
- **`packages/app/src/components/Dashboard/MobileDashboard.tsx`** (mobile flex-wrap)
- **`packages/app/src/pushToMain/PushedDashboardOverlay.tsx`** (pushed widgets on main)

All three wrap the rendered component with `<RequiresGuard requires={def.requires}>`. Empty / omitted → pass-through, no DOM.

### Per-widget annotations

Added `requires: ["flight"]` to:

`Navball, AtmosphereProfile, CommSignal, CurrentOrbit, DistanceToTarget, EscapeProfile, FuelStatus, KeplerPeriod, LandingStatus, ManeuverPlanner, MapView, OrbitalAscent, OrbitView, ScienceOfficer, SemiMajorAxis, TargetPicker, ThermalStatus, Twr, ActionGroup, GroundSurvey` (20 widgets).

Added `requires: ["career"]` to: `MissionDirector` (1 widget — sandbox saves have nothing meaningful).

Deliberately **not** annotated (handle their own state, or relevant outside flight):

- `SpaceCenterStatus, LaunchDirector` — render scene-specific state directly.
- `ScienceBench` — multi-mode (sensors when flying, career strip at SC); a blanket flight requirement would dim the legitimate SC-side career view.
- `Graph, Sparkline (uses Graph), DataSourceStatus, PerfBudgets` — meta or last-good widgets that stay relevant any time.
- `SystemView, CrewManifest, CameraFeed, WarpControl` — multi-scene or always-relevant.
- All `Kos*` widgets — depend on kOS proxy connection rather than scene; gating logic would differ. Skipped pending a `requires: ["kos"]` token if/when needed.

## Key contracts (don't break these)

- **`hasGameSignal` gate.** RequiresGuard suppresses the dim until at least one of `kc.scene` / `career.mode` has arrived. Don't remove this — the page refresh + WS warmup window would otherwise dim every widget for ~1 second.
- **Pass-through when `requires` is empty.** No wrapper DOM, no styling drift on the live path. Important because `<DimmedOverlay show=false>` children render through identically — but the wrapper still has cost when the show prop changes.
- **`ComponentRequirement` is a closed enum.** Don't accept arbitrary strings; the messages + hints are baked into RequiresGuard. Adding a new gate means: extend the type, add a branch in RequiresGuard, add a hint message.
- **The dim layer is `aria-hidden`.** Screen readers hear the banner once via `role="status"`, not the stale telemetry. Don't change this without rethinking the announcement strategy.

## File map

```
mod/GonogoTelemetry/
  src/KscApi.cs                       — adds kc.scene

packages/ui/src/
  DimmedOverlay.tsx                   — NEW. Primitive
  DimmedOverlay.test.tsx              — NEW. 3 tests
  index.ts                            — exports DimmedOverlay

packages/core/src/
  hooks/useGameContext.ts             — NEW. Hook
  types.ts                            — adds requires + ComponentRequirement
  index.ts                            — exports useGameContext

packages/components/src/shared/
  RequiresGuard.tsx                   — NEW. Orchestrator wrap helper
packages/components/src/
  index.ts                            — exports RequiresGuard
  Navball, AtmosphereProfile, …       — 20× requires: ["flight"]
  MissionDirector                     — requires: ["career"]

packages/app/src/components/Dashboard/
  GridItemContent.tsx                 — wraps <Comp> with <RequiresGuard>
  MobileDashboard.tsx                 — wraps <Comp> with <RequiresGuard>
packages/app/src/pushToMain/
  PushedDashboardOverlay.tsx          — wraps <def.component> with <RequiresGuard>
```

## Where to start when something breaks

- **Every widget dims even when in flight:** `kc.scene` isn't arriving. Subscribe to it via the Data Source widget; the GonogoTelemetry plugin must be installed and registered. `useGameContext` falls back to "Unknown" without it, and `hasGameSignal` stays false.
- **A widget never dims when it should:** check the registration's `requires` field — if it's missing or empty, the orchestrator passes through. The flight-only widgets are listed in this entry's "Per-widget annotations" section.
- **Banner overlaps the widget header / config gear:** `<DimmedOverlay>`'s banner has `z-index: 1` to sit above dimmed content but below modals. The header sits in `<CellHeader>` which is a sibling of `<ComponentWrapper>` — should be unaffected. If they overlap, check that GridItemContent.tsx still renders the header outside the wrapper.
- **Layout shifts when transitioning live → dim:** `<DimmedOverlay>` toggles between `<>{children}</>` and `<Wrap>...</Wrap>`. The wrap is `position: relative; width: 100%; height: 100%` — if a parent grid cell expects a specific direct-child shape, this can drift. None of our widget shells are picky about this, but watch for it.

## Out of scope (deferred)

- **`requires: ["kos"]`** — kOS-driven widgets (KosTerminal, KosFiles, KosProcessors, KosWidget, KosWrapperTester, ShipMap) need a different gate (kOS proxy connection state, not scene). Add when the user wants those dimmed too.
- **Per-widget message override.** Currently `RequiresGuard` picks the message based on which requirement is unmet. A widget that wants a custom hint (e.g. "Mun probe required") would need a `requireMessageOverride` prop. Defer until it's actually wanted.
- **Live dim vs full-blank threshold.** Right now the dim is always 35% opacity. A future enhancement: increase the opacity ramp based on how stale the data is (5min → 35%, 30min → 15%, never-arrived → 5%). Not on the path until we hit a case where 35% is misleading.

## Commits

- (uncommitted at time of writing — this entry will be updated on commit)
- Predecessors: `e992bd8` (Phase 4 slice 2)
