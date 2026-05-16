# 2026-05-16 — Ship Map Phase 2: harness, snapshots, sizing, freeze fix

**Status:** ⏳ pending — landed and CI-green, partially live-verified (orientation + sizing + fuel-line target captured on 2026-05-16); part-state overlays + bounds.center still need a KSP capture with `v.partState` + bounds.center pulled to fully exercise the rendering path.

**Commits:** `14c4756`..`2018b94` on `main`; fork side `c0cc3bd`..`2f852ec` on `telemachus/parts-topology` (plus combined-branch DLL builds on `test-combined-2026-05-16`).

**Driven by:** `local_docs/2026-05-16-phase-2-shipmap-handoff.md` (the
fresh-session handoff doc from the 2026-05-15 session). All items in
the doc's numbered Phase 2 plan that didn't need a fork rebuild or new
plumbing landed here.

## What shipped

### Item 1 — SVG-render harness (`14c4756`)

Split the SVG body of `ShipDiagram` into a pure `ShipDiagramSvg`
component — no `Wrapper` / `ResetButton` / `Tooltip` chrome, no
`useZoomPan` state. `ShipDiagram` becomes the interactive shell that
wraps it; harness + snapshot tests render via the same code path the
live widget uses.

`renderShipMapToSvg(parts, opts)` (`packages/components/src/ShipMap/render.ts`)
SSRs the component via `react-dom/server` + a `ServerStyleSheet`,
strips non-deterministic styled-components class names, and inlines
the dark-mode CSS variables the diagram references so output is
self-contained.

`pnpm --filter @gonogo/components render-ship-map` (driver:
`scripts/render-fixtures.ts`) loops over every fixture in
`__fixtures__/` and writes one SVG per fixture to
`local_docs/ship-map-renders/`. `tsx` is the runner; `TSX_TSCONFIG_PATH=tsconfig.json`
is needed so the script outside `src/` picks up the package's
`jsx: react-jsx` setting.

### Item 5 — Drop `pos` row from tooltip (`387b95c`)

`orgPos` is an internal projection coordinate, not useful to operators.
Tooltip now shows type / mass / temp / stage / resources only.

### Item 2 — SVG snapshot tests (`0a60f4a`)

Five `toMatchSnapshot` assertions — one per recorded fixture plus the
empty-parts placeholder. Renders go through the same
`renderShipMapToSvg` helper as the CLI harness. Floating-point
coordinates are rounded to 2dp before snapshotting so unrelated numeric
refactors stay diff-free. When a snapshot legitimately needs updating:
regenerate harness output, eyeball the SVGs in
`local_docs/ship-map-renders/`, then `vitest -u`.

### Item 6 — `useTopology` destruction-cascade freeze fix (`4eddd21`)

Root cause: the 2 s `FETCH_TIMEOUT_MS` safety dropped the `v.topology`
subscription on its own. During a destruction cascade Telemachus can
be busy long enough that the timeout fires; if seq then stabilises
before a push arrives, no new bump triggers a refetch and the widget
freezes at the pre-cascade snapshot.

The timer isn't needed. The subscribe handler already unsubs on the
first valid push, so per-bump bandwidth stays capped at one payload
regardless. Without the timer the subscription self-heals — once
Telemachus catches up, its next push lands on a still-live
subscription. Regression test exercises the exact cascade shape (emit
seq=1 + topology=1, bump seq four times with no topology pushes, then
push topology=5).

**Live verification:** force a destruction cascade (rover crash, large
debris field) and confirm the Ship Map widget's seq + topology stay
in lock-step after the cascade ends. The 2026-05-15 rover-crash test
plan in `local_docs/2026-05-15-fork-v2-and-docking-test-plan.md` covers
the relevant scenario.

### Heat tint overlay (Item 3a — `eba1c78`)

The previous `heatTint` blended via `parseHex(#RRGGBB)` against
CSS-variable strings — `parseHex` only matches `#RRGGBB`, so the blend
always short-circuited and returned the base. The temperature ramp has
been a no-op since this code first landed.

Replaced with a translucent overlay rect:

- < 50 % of `maxTemp`: no overlay.
- 50–80 %: amber overlay, opacity 0 → 0.5.
- 80–100 %: red overlay, opacity 0.55 → 0.85.

Stays CSS-variable driven (no resolved-hex palette to keep in sync with
`global.css`) and reads boldly at high temperatures — which is when the
operator actually needs to notice. Hottest-part highlight ring (driven
by `therm.hottestPartName`) is unchanged.

**Live verification:** reentry burn or sustained engine burn against a
heat-soak part; confirm the per-part tint ramps up alongside the
existing hottest-part highlight.

### Sizing fix — project parts at correct prefab bounds (`a1e52bc`)

User flagged on 2026-05-16 that part shapes still looked like the
kOS-based map — bounds were "in play" but not being used meaningfully.

Root cause: `intrinsicSize` read `s.z / 2` as axial half-extent and
`max(s.x, s.y) / 2` as lateral. KSP's `bounds.size` is in part-local
frame where Y is the axial extent (FL-T200: x=z=1.25, y=1.95 tall;
LgRadialSolarPanel: x=0.80, y=1.60 long, z=0.16 thin). So a 0.16 m
thin solar panel was rendering as a 1.6 m wing because its axial
dimension was mistaken for lateral.

Fix:
- `latHalfExtent = (useX ? size.x : size.z) / 2` computed once in
  `buildShipMapPart` so the lateral-axis choice stays co-located with
  `pickLateralAxis`.
- `axialHalfExtent = size.y / 2` (vessel-local Y is the spine).
- `intrinsicSize` reads the precomputed fields.
- `MIN_HALF_EXTENT` floor removed — per user preference, project tiny
  parts at their actual tiny size and let pinch-zoom handle readability
  ([[feedback-ship-map-part-sizing]]).

Synthetic `ShipDiagram.test.tsx` parts updated to the Y-axial bounds
convention. SVG snapshots regenerated.

### Fork-emitted `up` + client-side part rotation (`c0cc3bd` fork, `2455c35` client)

Per-part orientation problem the harness surfaced: nose cones rendering pointing outward (should be up), TT-38K radial decouplers rendering as horizontal slabs (should be vertical), docking ports between two side-by-side rovers rendering wrong axis. Position-derived heuristics were possible but expensive in code + edge cases.

Fork change: `PartsTopologyDataLinkHandler.SerialisePart` now emits `up: [x, y, z]` per part from `part.orgRot * Vector3.up` — the part's local +up axis in the vessel's assembly frame.

Client change: `TopologyPart.up` is optional (defaults to `[0, 1, 0]` so legacy fixtures render identically). `buildShipMapPart` projects `up` into screen-space rotation by mapping vessel `+axial → screen-up` and `+picked-lateral → screen-right`. `ShipDiagramSvg` wraps each part's `<PartGroup>` in `<g transform="rotate(...)">` around the part's centre so the body shape, heat tint, fuel bars, EC/highlight rings all stay locked to the part's local frame.

**Live verification:** fork DLL is in `local_docs/syncthing/kspdata/...` after the build — needs a KSP restart to take effect. Once it does, re-capture the four fixtures via the helper `tele read v.topology` to lock the new orientation data into the snapshot fold.

### Mk1 capsule frustum + nose-cone dome + parachute dome (`2455c35`)

Three shape changes for visual readability:

1. **Capsule:** was a Q-curve dome whose apex fell short of the bounds top — the parachute appeared to float above the pod with a gap. Now a frustum (truncated cone) that fills bounds top-to-bottom; the parachute sits flush.
2. **Nose-cone:** new `nose-cone` PartType (detected by `name` containing `"nose"`) with a rounded dome shape via cubic Bezier with both control points at y, so the apex reaches the bounds top. Stops nose cones rendering as fin triangles under the `Aero` category fallback.
3. **Parachute:** was a rounded rect; now a stowed-canister dome (flat base, semicircular top, narrower than bounds to reflect the canister's footprint).

### Cargo bays no longer classify as fins (`cb2b946`)

`mk2CargoBayS` reports `ModuleLiftingSurface` (KSP gives cargo bays a
body-lift bonus), so the previous `classifyPart` returned `"fin"` and
a 2.5 m cargo box drew as a giant outward-pointing triangle. The fin
classification is now gated by `!hasCargoBay`, so cargo bays fall
through to `"other"` (plain rect).

Side-effect of the harness existing: this was visible the moment Item 1
landed. Without the harness it would have been chased on live KSP.

## Visual delta

Render the four fixtures and eyeball the before/after:

```bash
pnpm --filter @gonogo/components render-ship-map
# then open local_docs/ship-map-renders/*.svg in a browser
```

Each fixture shows:
- Rocket stacks at their real relative dimensions (pod compact, FL-T200
  tall, engine moderate, decoupler thin).
- Solar panels render as thin strips, not wings.
- Cargo bays render as rectangles, not triangles.
- Rover wheels are roughly square.

### Second-session additions (post-handoff doc)

The handoff plan covered through Item 6; the live capture session that followed in the same day extended the work as follows. All committed on top of `2455c35`.

**Recapture pass against the rebuilt fork DLL (`f94ffc2`).** Re-pulled rover-b-alone and rover-merged topology with `up` populated on every part. Added an edge-on rotation guard in `buildShipMapPart`: when both projected components of the up vector are near zero (radial parts mounted along the picked-away axis, where Unity emits negative-zero), short-circuit `rotationRad` to 0 instead of letting `Math.atan2(0, -0)` flip it 180°. Regression tests cover both the edge-on docking-port case and a properly-tilted side nose cone.

**Wheels render as circles (`9a13ac1`).** `ModuleWheelBase`-bearing parts get a dedicated `wheel` PartType (rover wheels were falling through to a default rect under `Ground` category before).

**Decoupler shape from body proportions (`9a13ac1`).** Stack decouplers (wide w, short h) keep the thin horizontal slab; radial decouplers (tall narrow body) flip to a full-extent rounded rect that bridges the parent stack and the side stack, matching the prefab's real footprint.

**Fuel-line target field (`e5f7b06` fork, `f78ac7f` client).** `CModuleFuelLine.target` (inherited from `CompoundPartModule`) resolves to a `flightID` and rides on the per-part payload as `fuelLineTarget`. Client renders a yellow source→target arrow as a separate pass after the parts loop.

**Fuel-line pipe + chevrons (`3416bca`).** Replaced the single source→target line with a stubby rounded-rect pipe carrying a row of dark blue chevrons pointing along the flow direction. Each pipe lives in a rotated local frame whose +X axis points source→target, so chevrons in local +X are always toward the target regardless of the pipe's screen orientation.

**bounds.center for radial-mount parts (`d03a266` → `2f852ec` fork, `30b6e47` client).** `PartGeometryUtil.MergeBounds` returns both `.size` and `.center` — for radial decouplers, surface ladders, structural brackets the mesh centre doesn't sit on the attach-node anchor. Fork now pre-rotates `bounds.center` by `orgRot` and emits the vessel-frame offset alongside `bounds.size`. Client uses `orgPos + boundsCenter` to position the body box so the rendered shape sits on the mesh centre, not the anchor. Existing fixtures fall back to the zero default. **Needs a fresh capture against the rebuilt DLL** to fully verify radial decouplers no longer overlap the parent tank in the rendered SVGs.

**Part-state overlays (`ba81303`).** End-to-end plumbing for `v.partState[flightId]`:
- `@gonogo/core`: `PartState` + `PartStateModule` types.
- `@gonogo/data`: `usePartsLive` subscribes alongside the existing resource + thermal keys.
- `@gonogo/components`: `ShipMapPart.partState` pass-through; `renderPartStateOverlays` adds visual indicators per supported module — engine flame (active), parachute marker / canopy / mushroom (armed / deploying / extended), deploy chevron (solar / radiator / antenna mid-animation), landing gear stand (extended), cargo bay open mark (extended). All overlays sit inside the per-part rotation transform so they project correctly on radially-mounted parts.

**Inspect helper (`30b6e47`).** New `scripts/inspect_fixture.py` with subcommands `parts`, `modules`, `name`, `radial`, `fuel-lines`, `field`, `bounds` so future fixture inspection isn't ad-hoc `python3 -c …`.

## What did NOT ship

Tracked for a future session:

- **Live-capture demonstration of part-state overlays.** Harness path
  (`scripts/render-fixtures.ts`) passes `partState=undefined`. Fixtures
  on disk don't carry partState. To exercise the rendering in the
  snapshot fold, a future capture session would need to pull
  `v.partState[fid]` for each part alongside the topology snapshot and
  write a sidecar JSON the harness reads. Unit tests cover the path;
  visual verification will happen in live KSP.
- **bounds.center verification.** The fork side emits it, the client
  consumes it, but the recorded fixtures don't have it yet. Next
  capture against the rebuilt DLL will surface whether the radial
  decoupler now bridges the gap as designed.
- **Fork-side fuel-line flow magnitude.** The current arrow visualises
  direction only. Per-line flow rate would need either KSP's
  ResourceFlowGraph exposed via the fork or a heuristic from
  source-tank drain rate. Deferred per the 2026-05-16 design chat.

## Files touched

```
packages/components/scripts/render-fixtures.ts          (new)
packages/components/src/ShipMap/ShipDiagramSvg.tsx      (new — extracted)
packages/components/src/ShipMap/render.ts               (new)
packages/components/src/ShipMap/shipTopology.test.ts    (new)
packages/components/src/ShipMap/snapshots.test.ts       (new)
packages/components/src/ShipMap/__snapshots__/          (new dir)
packages/components/src/ShipMap/ShipDiagram.tsx         (slimmed → shell)
packages/components/src/ShipMap/ShipDiagram.test.tsx    (new sizing + heat tests)
packages/components/src/ShipMap/shipTopology.ts         (lat/axial extents + cargo bay gate)
packages/components/src/ShipMap/fixtures.test.tsx       (biome key-style tweak)
packages/components/package.json                        (tsx devDep + render-ship-map script)
packages/data/src/hooks/useTopology.ts                  (timer removed)
packages/data/src/hooks/useTopology.test.tsx            (cascade regression)
local_docs/ship-map-renders/*.svg                       (CLI output)
```
