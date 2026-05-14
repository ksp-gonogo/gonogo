# Ship Map widget — re-wired onto Telemachus v.topology

**Date:** 2026-05-14
**Task:** Follow-on to the Telemachus parts API PR drafted earlier on 2026-05-14 (`local_docs/2026-05-14-parts-api-design-feedback.md`, branch `telemachus/parts-topology` in the fork). The fork PR added `v.topology`, `v.topologySeq`, `r.resourceFor[flightId]` and `therm.part[flightId]`; this commit pulls the Ship Map widget over to that new data path.
**Validation:** ✅ confirmed 2026-05-15 — fork API curl-validated 2026-05-14 (see "Live curl validation" below); widget rendering visually confirmed against Validator-1 in the 2026-05-15 live pass. One rendering bug found and fixed inline: side-view picker was rotated 90° because the axis convention assumed Z was the spine; corrected to KSP's local-Y stack-axis convention.

## Overview

The Ship Map widget no longer routes through kOS. It subscribes directly to Telemachus:

1. `v.topology` — the cached structural snapshot. Server-side rebuilds happen on staging / docking / decoupling / part-death / vessel-switch events. The widget just consumes the latest snapshot.
2. `usePartsLive(flightIds)` — a new hook (`@gonogo/data`) that opens a paired `r.resourceFor[flightId]` + `therm.part[flightId]` subscription for every part the topology emits, and surfaces a `Map<flightId, { resources, thermal }>`. Re-subscribes when the id set changes.
3. `therm.hottestPartName` — unchanged. Still drives the "hot" highlight ring.

The diagram renders from the union of those three streams. The kerboscript pipeline (kOS centralised compute → `[KOSDATA:shipmap]` parser → ring buffer) is gone for this widget.

## Files

- `packages/core/src/schemas/telemachus.ts` — new `TopologyPart` / `VesselTopology` / `PartResources` / `PartThermal` interfaces; `v.topology` and `v.topologySeq` added to `TelemaachusSchema`.
- `packages/data/src/hooks/usePartsLive.ts` (new) — the dynamic per-part subscription hook. Exported from `packages/data/src/index.ts`.
- `packages/components/src/ShipMap/shipTopology.ts` (new) — view-model (`ShipMapPart`), `classifyPart()` (port of the kerboscript module-list derivation), `pickLateralAxis()`, `buildShipMapPart()`. Replaces the old `shipMapScript.ts`.
- `packages/components/src/ShipMap/index.tsx` — rewritten. Drops `KosScriptFrame`, the `refreshOnStage` config, the `dispatchNow / reEnable` actions, the tag chip-row, and the `useKosScriptStatus` plumbing.
- `packages/components/src/ShipMap/ShipDiagram.tsx` — rewritten around `ShipMapPart` and prefab `bounds.size`. `intrinsicSize()` is now a 6-liner that reads `size.x/y/z` directly; the mass-cubed-root heuristic and per-type sizing table are gone. Projection / stack-slab stretching / decoupler width inheritance / side-child containment all retained.
- `packages/components/src/ShipMap/ShipDiagram.test.tsx` — fixtures rewritten to the new shape.
- `packages/components/src/ShipMap/shipMapScript.ts` — deleted.

## Deliberate regressions vs the kOS-backed version

1. **Tag chip-row is gone.** The old widget exposed the kOS `p:TAG` (right-click → "set tag") as cyan badges + a chip-row filter at the top of the widget. Telemachus has no equivalent: KSP's stock `Part` object doesn't carry a player-set tag — `p:TAG` was a kOS-only field. Bringing tags across would mean extending the fork's `v.topology` payload, and I didn't want to widen the open PR's scope. If we want tag chips back, the fix is a small `tag` string addition to `PartsTopologyDataLinkHandler.SerialisePart` keyed off some other KSP signal (e.g. `Part.nameTag` if it exists, or the kOS-set tag via cross-mod metadata) — not blocking.
2. **Auto-refresh-on-stage toggle is gone.** It was a workaround for the kerboscript's 30s passive cadence. The new path is event-driven — staging fires `onVesselWasModified` server-side, the topology cache invalidates, the seq ticks, the client re-renders. There's nothing left to toggle.
3. **"Run" button + "Re-enable script" button are gone.** Same reason — no script to re-dispatch, no per-topic breaker to clear. The KosScriptFrame chrome is replaced by a thin `<Meta>` header showing part-count + `seq` + hottest-part name.

## Wins

- **Real bounds.** `intrinsicSize` is now `halfH = size.z/2; halfW = max(size.x, size.y) / 2`, computed from the prefab renderer-bounds the fork emits. No more cube-root-of-mass guessing — radial parts, light-but-large parts, deployables-when-extended, all read accurately.
- **No kOS CPU pressure.** Removing the SHIP:PARTS enumeration off the kerboscript hot path is the kind of thing the kOS-feels-slow feedback was pointing at.
- **No proxy parsing.** `[KOSDATA:shipmap]` is no longer in the telnet-proxy parse loop for this widget.
- **Event-driven invalidation.** No 30s lag, no need to refresh-on-stage manually.

## Per-part subscription mechanics

The widget subscribes to one `r.resourceFor[fid]` + one `therm.part[fid]` per part — order-of-magnitude 50–200 subscriptions on a typical career-mode vessel. The Telemachus WebSocket already handles many concurrent keys (FuelStatus, the navball stack, the orbital info stack) so this isn't introducing a new pressure category. Worth watching the BufferedDataSource budget if a future user runs a 500-part monstrosity; the perf-budget gate would catch it before it tanks the dashboard.

The `usePartsLive` hook re-subscribes only when the set of `flightIds` changes — keyed on a sorted string proxy of the array, not array identity. So a no-op topology rebuild (same parts) doesn't churn the subscription set.

## Validation checklist (for the next live session)

- Load a multi-stage career vessel; confirm the diagram renders, sized accurately by bounds, with the hottest-part highlight working as before.
- Stage; confirm the topology rebuilds (part-count drops, layout reflows) without any client action.
- Decouple a radial booster mid-flight; same.
- Engine fire; confirm fuel-fill bars on the live LF/Ox tank drain visibly. (Per-part `r.resourceFor[fid]` is the load-bearing key.)
- Reentry; confirm per-part heat tint pushes affected parts amber → red. (Per-part `therm.part[fid]`.)
- Dock with another vessel; confirm the topology grows to include the docked craft's parts and the seq bumps.
- Tracking Station → switch to a different active vessel; confirm the diagram reloads (this needs the `onVesselChange` hook I added to the fork late, commit `4d1252c`).

## Known projection limitation (carried over from the kOS version)

The 2D side-view picks whichever lateral axis has the wider spread. Parts on the other axis still project onto the spine and overlap. Not fixed in this rework — would need a real 3D viewer.

---

## Live curl validation — 2026-05-14

Tested against the parts-topology DLL with two test rockets on the launchpad. Curl-only — did not visually verify the widget in a browser; promote to ✅ once that's done.

| Check | Result |
|---|---|
| `v.topology` shape, all fields populated | ✅ 9-part `tester` rocket, all keys present |
| Prefab bounds carry real (non-zero) sizes | ✅ Mk1 pod 1.25×1.14×1.25 m, etc. |
| `v.topologySeq` numeric, lightweight | ✅ int |
| Seq stable across non-structural events | ✅ stayed at 3 through engine fire, full SF burn, parachute arming, 45km arc |
| Seq bumps on full-vessel destruction (crash) | ✅ 3 → 29 on splash impact (26 invalidations across `onPartDie` cascade) |
| Seq bumps on decouple | ✅ 33 → 36 (decoupler stage on the second rocket; active vessel correctly downsized 10 → 3 parts) |
| Both seq sources agree (key + embedded) | ✅ `v.topologySeq` == `v.topology.topologySeq` |
| Empty-vessel handled gracefully | ✅ post-disintegration `parts: []` doesn't blow up |
| `r.resourceFor[fid]` tracks live fuel burn | ✅ booster SF 375 → 0 across the burn |
| `therm.part[fid]` tracks live heating | ✅ booster 296 K → 553 K peak at burnout |
| Dead-flightId lookups degrade gracefully | ✅ `r.resourceFor` → `{}`, `therm.part` → `1` (Telemachus partless-paused sentinel — pre-existing Telemachus behavior, widget treats non-object as "no thermal" and skips heat tint) |

**Outstanding live checks** (not exercised today — need separate flight scenarios):

- Dock event bumps seq (requires a second vessel in orbit).
- ~~Tracking Station "Fly" to a different vessel bumps seq~~ — confirmed in the 2026-05-15 pass; Tracking Station → Fly cycle bumped `v.topologySeq` 198 → 325 across the swap + heat-shield destruction cascade.
- ~~Widget renders correctly end-to-end in the browser~~ — confirmed 2026-05-15 against a live Validator-1 craft (initial 18-part stack and post-decouple 5-part stack both rendered with sensible silhouettes once the axis fix landed).

### 2026-05-15 follow-up — axis rotation fix

Symptom: vessel rendered horizontally instead of vertically, parts strung along the lateral axis. Root cause: `pickLateralAxis()` compared X-spread vs Y-spread (then picked the wider as lateral), and `buildShipMapPart` hardcoded `axial: orgPos[2]`. KSP's local-frame convention is that Y is the stack axis and X/Z are the two lateral axes — so the picker was inadvertently choosing the stack axis as lateral. Fix: pickLateralAxis now compares X-spread vs Z-spread; `buildShipMapPart` reads `axial: orgPos[1]` and `lat: useX ? orgPos[0] : orgPos[2]`. Tests already use precomputed `lat`/`axial` values so no fixtures needed updating.

### Other observations from the 2026-05-15 pass

- `v.topologySeq` is bumped more aggressively than the design predicted — 83 → 198 across one suborbital flight (decouple + parachute deploy + heat-shield destruction + ground impact) and another 100+ across a Tracking-Station-driven vessel swap. Each individual bump traces to a real KSP event, but downstream consumers should be tolerant of frequent invalidations; the seq-driven refetch hook handles this gracefully (the wire cost stays low because `v.topology` only flows after a bump).
- `therm.part[<deadFlightId>]` returned `null` rather than the `1` partless-paused sentinel reported in the original validation. Both satisfy the client's "non-object = no thermal" contract; the variation is likely active-vs-paused scene state.

### Performance follow-up surfaced during validation

The original implementation subscribed to `v.topology` directly, which sends the full topology payload at the WS rate (~4Hz) even when the seq hasn't changed. For a 100-part vessel that's ~28KB/s of redundant traffic. The design doc's intended pattern was "subscribe to `v.topologySeq`, refetch `v.topology` only on bump" — landed in a follow-up commit as the new `useTopology` hook in `@gonogo/data`. See `2026-05-14-ship-map-seq-driven-refetch.md`.
