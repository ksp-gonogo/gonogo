# tar.availableVessels — native vessel listing, retires kOS feed

**Date:** 2026-05-14
**Validation:** ⏳ pending — landed and tested in CI (full suite green,
lint + typecheck clean, TargetPicker tests rewritten for the native
contract). Telemachus DLL compiled and synced to the KSP install via
syncthing; needs a KSP restart + live vessel-targeting pass.

## What changed

Replaces the kOS-driven Target Picker vessels feed with a native
Telemachus key: `tar.availableVessels`. The kOS workflow was a
workaround for the fact that the existing `tar.setTargetVessel` takes
an integer index into `FlightGlobals.Vessels` that no other key
exposes — so the index was dead weight. Adding a server-side
enumeration of that list (paired with `tar.setTargetVessel`'s contract)
lets the client target any vessel without running a kerboscript.

### Fork (Telemachus.dll)

New `[TelemetryAPI("tar.availableVessels", …)]` handler in
`Telemachus/src/NavigationHandlers.cs`. Walks `FlightGlobals.Vessels`,
skipping Flag / EVA / Debris / Unknown and the active vessel itself,
emitting:

```json
[
  {
    "index": 12,                     // matches tar.setTargetVessel[index]
    "name": "Munar Orbiter",
    "type": "Probe",                 // Vessel.vesselType enum
    "situation": "ORBITING",         // Vessel.Situations enum
    "body": "Mun",
    "position": [184523.4, 12055.2, -3217.8]
                                     // active vessel's local frame
                                     // (transform.InverseTransformPoint)
  }
]
```

`List<Dictionary<string, object>>` returned directly — MiniJSON's
generic-collection encoder handles it without a dedicated formatter.

The handler skips the active vessel and walks `FlightGlobals.Vessels`
without re-sorting. Indices stay stable across emissions.

### Client schema + meta

- `AvailableVesselEntry` interface in `packages/core/src/schemas/telemachus.ts`,
  matching the wire shape exactly.
- `"tar.availableVessels": AvailableVesselEntry[]` added to
  `TelemaachusSchema`.
- Meta entry under "Target" group.

### TargetPicker rewrite

- Subscribes to `tar.availableVessels` directly via `useDataValue`.
- Sorts client-side by `position` magnitude — no longer rounding to 1
  decimal as the kerboscript did.
- Click handler fires `tar.setTargetVessel[<index>]` — the integer
  index from the wire entry.
- Pending-target state keys by `vessel:${entry.index}` (was
  `vessel:${name}@${distance}`).
- Refresh button **deleted** — the WS subscription is continuous; the
  kOS feed's 5-second cadence was a polling artifact.
- "✓ Updated" flash deleted — not needed when the data is live.
- kOS data source dependency dropped — no more `getDataSource("kos")`,
  `useKosScriptStatus`, `useExecuteAction("kos")` from this widget.
- Config component reduced to a single descriptive Field; no more
  kOS-CPU language.

### Retired files

Deleted:

- `packages/components/src/TargetPicker/vesselListScript.ts` — the
  kerboscript + `registerKosScript` self-registration. Topic id
  `target-vessels` no longer needed on the kOS data source.
- `packages/components/src/TargetPicker/setTargetScript.ts` — the
  per-click set-target RPC kerboscript. Replaced by
  `tar.setTargetVessel[index]`.

### Tests

`TargetPicker/index.test.tsx` rewritten:
- Drops the `registerFakeKosSource` helper and topic-status
  scaffolding.
- Drops the "Refresh fires …dispatchNow" and "clicking sets target via
  set-target script" tests.
- Adds: subscribe to `tar.availableVessels`, sort by `position`
  magnitude, click fires `tar.setTargetVessel[<server-index>]`.

## Files

- `local_docs/telemachus-fork/Telemachus/src/NavigationHandlers.cs` —
  new handler.
- `local_docs/syncthing/kspdata/GameData/Telemachus/Plugins/Telemachus.dll`
  — rebuilt and synced (KSP restart needed to pick up).
- `packages/core/src/schemas/telemachus.ts` — `AvailableVesselEntry`,
  schema key.
- `packages/data/src/schema/telemachusMeta.ts` — meta entry.
- `packages/components/src/TargetPicker/index.tsx` — full rewrite.
- `packages/components/src/TargetPicker/index.test.tsx` — full
  rewrite.
- Deleted: `packages/components/src/TargetPicker/vesselListScript.ts`,
  `setTargetScript.ts`.

## Validation checklist (next live session)

- KSP must be restarted to load the new Telemachus.dll. Confirm with
  `./scripts/gonogo_claude_tools.sh tele read tar.availableVessels`
  on a save with multiple vessels.
- Indexes returned by `tar.availableVessels[].index` must round-trip
  through `tar.setTargetVessel[N]` correctly — pick a row, click,
  verify the in-game target HUD lights up on the right vessel.
- Distance derived from `position` magnitude should match the in-game
  distance readout within float precision.
- Position frame: confirm it reads sensibly across different active
  vessels (rotation, translation) — `transform.InverseTransformPoint`
  is the standard Unity local-frame transform, so we expect this to
  Just Work.
- Active vessel exclusion: the active vessel should never appear in
  its own picker list.

## Why this matters

- One less moving part. The kOS feed required a running CPU, a
  registered script, a 5s polling cadence, and a third-party RPC.
  Native gets the same data straight from the WS.
- Steady-state cost drops. Each subscriber to the kOS feed bumped its
  fanout; now one Telemachus subscription covers every picker on every
  station.
- Unblocks `tar.setTargetVessel`. It was dead in stock Telemachus
  Reborn because no client could discover the indices.

## What didn't ship

- Optional `?include=` filter for Flag/EVA/Debris/Unknown vessels — the
  Telemachus subscribe model isn't a great fit for query-string args;
  if someone needs debris targeting we can add a parallel
  `tar.availableVesselsAll` later.
- Power Systems widget (`flow` / `nominalFlow` on `r.resourceFor`) —
  the other fork extension from the 2026-05-14 audit. Next.

Next item from the followups doc: fork PR B — `flow` / `nominalFlow`
on `r.resourceFor` + the Power Systems widget that consumes it.
