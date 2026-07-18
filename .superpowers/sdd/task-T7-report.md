# T7 report — Add mod-local scan schema/decode/reveal-sources (scansat Uplink)

**Status: DONE.** Executed the coordinator's Option C re-scope (additive-only, core/data
originals deleted in T9). Commit below.

## What changed vs. the original T7 plan text

The plan's literal text ("Move: ... drop the barrel re-export") is **not** independently
landable: every one of the five files it names has a live consumer in
`packages/components/src/MapView` (`index.tsx`, `scanOverlay.ts`+test, `useFogMask.ts`,
`useScanLayerCanvas.ts`) that isn't migrated off it until T8a/T8b/T8c/T9 land — and those tasks
depend on T7 having already landed, a genuine chicken-and-egg gap. Full detail on that
investigation is preserved below (original BLOCKED analysis). The coordinator resolved this as a
sequencing mechanic (same end state as the plan, different landing order) via **Option C**:

1. Create the mod-local canonical copies in `mod/GonogoScansatUplink/client/src/` — the scan
   schema plus decode/sync logic — sourcing generic fog primitives (`useBodyFogMask`,
   `FogMaskCache`, `useFogMaskCache`, `BodyMask`) from `@ksp-gonogo/data` as before, but the
   scansat-specific schema/decode/sync types from the new local `./schema` / `./FogReveal/*`.
2. Register the five fog reveal sources (`registerFogRevealSource`) from the new mod-local
   `FogReveal/useScanSatFogSync.ts`, at module load, using real `scansat:<Name>` layerIds
   (this is the owning uplink dir, so real mod-name literals are fine here).
3. Repoint the mod's own client files (`AnomalyOverlay/geometry.ts`+test, `AnomalyOverlay/
   index.tsx`, `Scanning/index.tsx`, `Scanning/Minimap.tsx`) off `@ksp-gonogo/core`/
   `@ksp-gonogo/data` onto the new local copies.
4. Leave `packages/core`/`packages/data` originals, `telemachus.ts`, and the
   `uplink-boundary.test.ts` allowlist completely untouched — MapView still compiles against
   them unchanged. Genuine transient duplication (mod copy + core/data copy) for the T7→T9
   window, as directed.

## Files

**New** (mod-local canonical copies):
- `mod/GonogoScansatUplink/client/src/schema.ts` — verbatim copy of
  `packages/core/src/schemas/scansat.ts`'s five interfaces + `SCAN_TYPE`/`SCANType`, header
  comment updated to point at this file as the new canonical home and note the still-duplicated
  copy in core (deleted at T9).
- `mod/GonogoScansatUplink/client/src/FogReveal/scanDecode.ts` — copy of
  `packages/data/src/scansat/scanDecode.ts`; only the `SCAN*` type import switched to `../schema`
  (logic unchanged).
- `mod/GonogoScansatUplink/client/src/FogReveal/useScanLayers.ts` — copy of
  `packages/data/src/scansat/useScanLayers.ts`; `SCAN*` types now from `../schema`, `./scanDecode`
  stays relative (same directory).
- `mod/GonogoScansatUplink/client/src/FogReveal/scanCoverageSync.ts` (+ `.test.ts`) — copy of
  `packages/data/src/fog/scanCoverageSync.ts`; `SCANCoverageBitmap`/`SCANType`/`SCAN_TYPE` from
  `../schema`, `BodyMask` from `@ksp-gonogo/data` (generic fog primitive, unmoved).
- `mod/GonogoScansatUplink/client/src/FogReveal/useScanSatFogSync.ts` — **rewritten**, not a
  straight copy: registers the five reveal sources at module load
  (`scansat:AltimetryLoRes` w=192, `scansat:AltimetryHiRes` w=255, `scansat:Biome` w=255,
  `scansat:ResourceLoRes` w=192, `scansat:ResourceHiRes` w=255) via `registerFogRevealSource`
  from `@ksp-gonogo/core`, and `cache.markDirty(bodyId, layerId)` now uses those
  `"scansat:<Name>"` string layerIds instead of the old `String(numericScanType)` stringify. The
  hook body (subscribe-per-type, acquire-then-subscribe, cleanup) is otherwise the same shape as
  the original.

**Modified** (mod-internal import repointing, mechanical, no behavior change):
- `AnomalyOverlay/geometry.ts`, `AnomalyOverlay/geometry.test.ts` — `SCANAnomalyEntry` now from
  `../schema` instead of `@ksp-gonogo/core`.
- `AnomalyOverlay/index.tsx` — `useScanAnomalies` now from `../FogReveal/useScanLayers` instead
  of `@ksp-gonogo/data`.
- `Scanning/index.tsx` — `SCANType`/`SCAN_TYPE` now from `../schema`; `useScanAnomalies`/
  `useScanningVessels` now from `../FogReveal/useScanLayers`.
- `Scanning/Minimap.tsx` — `SCANScanningVessel` now from `../schema`; `useScanAnomalies`/
  `useScanningVessels` now from `../FogReveal/useScanLayers`. `useBiomeCanvas`/
  `useFogDisplayCanvas` **stay** imported from `@ksp-gonogo/components` unchanged — those are
  MapView-owned, not part of this move, migrated later by T8c/T9.
- `mod/GonogoScansatUplink/client/src/index.ts` — added `import
  "./FogReveal/useScanSatFogSync";` as a bare side-effect import (same pattern as the existing
  `./Scanning`/`./ScienceAugment`/`./AnomalyOverlay` lines) so the five reveal-source
  registrations actually fire when the Uplink client loads; header comment updated.

**Untouched, as directed:** `packages/core/src/schemas/scansat.ts`,
`packages/core/src/schemas/telemachus.ts`, `packages/core/src/index.ts`,
`packages/data/src/scansat/*`, `packages/data/src/fog/scanCoverageSync.ts`,
`packages/data/src/fog/useScanSatFogSync.ts`, `packages/data/src/index.ts`,
`packages/core/src/uplink-boundary.test.ts` (allowlist unchanged, 5/5 still passes — none of the
five original files were touched or moved, so no entry goes stale).

## Test/verification status

- `npx turbo typecheck --force` — 33/33 packages pass (whole-repo, matches the pre-commit gate).
- `npx vitest run src/uplink-boundary.test.ts --root packages/core` — 5/5 pass, allowlist
  unchanged (not shrunk — expected, deferred to T9).
- `pnpm --filter @ksp-gonogo/scansat test` — 6 files, 38/38 tests pass.
- `pnpm --filter @ksp-gonogo/core test` — 45 files, 403/403 tests pass.
- `npx biome check --write mod/GonogoScansatUplink/client/src` — applied safe formatting/import-
  order fixes; 3 remaining `noRestrictedImports` (styled-components) warnings are pre-existing
  (one is in `ScienceAugment/index.tsx`, a file this task never touched) — not new findings.
- `git diff --stat pnpm-lock.yaml` — empty, lockfile untouched (no new dependency edges; both
  `@ksp-gonogo/core` and `@ksp-gonogo/data` were already dependencies of `@ksp-gonogo/scansat`).
- Pre-commit hook ran clean on the actual commit (biome + full cross-package typecheck).

## Commit

`feat(scansat): add mod-local scan schema/decode/reveal-sources (core/data originals deleted in T9)`

Files staged: `mod/GonogoScansatUplink/client/src/schema.ts`, `mod/GonogoScansatUplink/client/
src/FogReveal/*`, `mod/GonogoScansatUplink/client/src/AnomalyOverlay/{geometry.ts,
geometry.test.ts,index.tsx}`, `mod/GonogoScansatUplink/client/src/Scanning/{index.tsx,
Minimap.tsx}`, `mod/GonogoScansatUplink/client/src/index.ts`.

**SHA: `0f27ca29c606ebce8319a5e3fd45fce32ea45582`.** Pre-commit hook (biome check + full
`turbo typecheck` across 33 packages) passed clean.

## Follow-up for T9 (not this task)

- Delete `packages/core/src/schemas/scansat.ts`, `packages/data/src/scansat/*`,
  `packages/data/src/fog/scanCoverageSync.ts`, `packages/data/src/fog/useScanSatFogSync.ts` once
  `packages/components/src/MapView`'s `index.tsx`/`scanOverlay.ts`/`useFogMask.ts`/
  `useScanLayerCanvas.ts` no longer need them (after T8a/T8b/T8c land).
- Apply the `telemachus.ts` local-types fix (preflight's Option (a): inline the 5 wire-shape
  interfaces it needs) at that point — deferred here per the coordinator's explicit instruction
  not to touch it in T7.
- Shrink the `uplink-boundary.test.ts` scansat allowlist by the (at that point genuinely stale)
  entries for the deleted core/data files.

---

## Original BLOCKED analysis (superseded by Option C above, kept for record)

T7 as scoped in the plan (`docs/superpowers/plans/2026-07-18-mapview-overlay-host-foundation.md`,
`## T7`) is not independently landable under this repo's pre-commit whole-repo `turbo typecheck`
gate if it deletes the `packages/core`/`packages/data` originals in the same commit — the
preflight caught the `telemachus.ts` break and the ratchet staleness, but a fuller consumer sweep
found `packages/components/src/MapView`'s still-unmigrated files (`index.tsx`, `scanOverlay.ts`+
test, `useFogMask.ts`, `useScanLayerCanvas.ts`) also depend on the same five files, and those
aren't migrated off them until T8a/T8b/T8c/T9 — tasks whose own dependency edge requires T7 to
land first. Three ways to force a same-commit deletion were considered and rejected (real design
work belonging to later tasks; a core/data→mod re-export creating an actual dependency cycle,
since `@ksp-gonogo/scansat` already depends on `@ksp-gonogo/components`/`core`/`data`; and a local
copy inside `packages/components` that would add a new, currently-nonexistent `"scansat"` literal
ratchet violation to a shared package). The coordinator's Option C — land the mod-local copies
additively now, defer the core/data deletion to T9 — resolves this without any of those three
problems, and is what was executed above.
