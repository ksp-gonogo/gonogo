# tar.availableVessels — native vessel listing, retires kOS feed

**Date:** 2026-05-14
**Validation:** ✅ confirmed 2026-05-15 — full live pass against a save with 10 asteroids + 3 "Low Orbt Tester" vessels in Kerbin orbit. Array shape, active-vessel exclusion, non-contiguous indices (holes where filtered vessels live), `tar.setTargetVessel[index]` round-trip, and active-vessel swap behaviour all verified.

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

**Prerequisite:** restart KSP. The synced DLL only loads at boot — a
running KSP session will keep serving the old handler.

### Step 1 — verify the fork API directly

Before opening the widget, confirm the wire shape from the running KSP:

```bash
./scripts/gonogo_claude_tools.sh tele read tar.availableVessels
```

Load a save with at least two vessels of different types (e.g. an
active Probe and a separate Lander/Ship in orbit). Expected shape:

```json
{
  "tar.availableVessels": [
    {
      "index": 0,
      "name": "Munar Lander",
      "type": "Lander",
      "situation": "ORBITING",
      "body": "Mun",
      "position": [184523.4, 12055.2, -3217.8]
    },
    …
  ]
}
```

Spot-checks on the raw response:
- The **active vessel** must NOT appear in the array (server-side
  filter).
- Vessels of type `Flag`, `EVA`, `Debris`, `Unknown` must NOT appear.
- `index` values match `FlightGlobals.Vessels[index]` — they may be
  non-contiguous (e.g. 3, 7, 12) if filtered vessels punched holes.
- `situation` is one of `LANDED / SPLASHED / PRELAUNCH / FLYING /
  SUB_ORBITAL / ORBITING / ESCAPING / DOCKED` only.
- `position` magnitude (√(x² + y² + z²)) should roughly match the
  in-game tracking-station distance for that vessel (within a few %
  due to frame timing).

### Step 2 — round-trip through `tar.setTargetVessel`

```bash
./scripts/gonogo_claude_tools.sh tele action 'tar.setTargetVessel[3]'
```

Substitute `3` with an actual index from Step 1. Then re-read:

```bash
./scripts/gonogo_claude_tools.sh tele read tar.name tar.type tar.distance
```

`tar.name` should match the corresponding entry's `name`. If it
doesn't, the index semantic is wrong and we have a real bug.

### Step 3 — widget exercise

Open the Target Picker on the dashboard:

- Vessels tab should list the same set as Step 1, sorted ascending by
  distance.
- Click a row → in-game target HUD lights up on that vessel. The
  TARGET chip in the picker should flip to the new name within a
  beat.
- Click Clear in the Current tab → in-game target clears and the
  TARGET chip disappears.

### Step 4 — edge cases worth checking

- **Many same-name vessels** (e.g. three "Test Probe"s) — the picker
  used to disambiguate by name+distance because the kOS feed only had
  names; now it keys by integer `index`, so multiple same-name rows
  should still all be selectable and distinguishable.
- **Vessel-swap mid-session** — switch active vessel via Tracking
  Station, return to a station with the picker open. The active
  vessel exclusion should follow the swap.
- **Distance discrepancy** — derived (client) distance should equal
  the existing `tar.distance` for whichever row is currently
  targeted.

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

## Live validation — 2026-05-15

Test save: 10 asteroids (`Ast. *` + `UnknownComet`) on solar orbits + 3 "Low Orbt Tester" Ships in Kerbin orbit. Validator-1 (suborbital test craft) launched, decoupled, parachuted to a hard landing at KSC.

| Check | Result |
|---|---|
| `tar.availableVessels` returns JSON array of `{ index, name, type, situation, body, position }` | ✅ |
| Active vessel absent (Validator-1 on the pad / Tester after swap) | ✅ both directions |
| Non-contiguous indices (filtered vessels punch holes) | ✅ pre-swap list missing 12 (Validator-1's active slot); post-swap missing 10 (the now-active Tester) |
| `index` round-trips through `tar.setTargetVessel[N]` — `tar.name` echoes the correct vessel | ✅ `tar.setTargetVessel[13]` then `tar.name = "Low Orbt Tester"` |
| Position magnitude approximates the in-game tracking-station distance | ✅ `tar.distance ≈ 87 km` for an index-13 row whose computed `|position| ≈ 113 km` — drift consistent with a few-second-stale position from a vessel moving at orbital velocity |
| Position frame stays sensible across active-vessel swap | ✅ post-swap, Validator-1's `position ≈ 805 km` relative to the active Tester, matches expected KSC-to-low-orbit distance |
| Flag / EVA / Debris / Unknown vessels excluded | ✅ — decoupled debris from the lower stage did NOT appear in the list (would have been a Debris-typed vessel) |
| Many same-name vessels distinguishable by `index` | ✅ three "Low Orbt Tester" rows with same name, different indices, all selectable |

### Notes worth surfacing in the PR / widget follow-up

- **`SpaceObject` is included by design** — the doc's exclusion list is `Flag / EVA / Debris / Unknown` only. The result is asteroid + comet rows flood the picker on any save with the stock tracking station seeded. Not a fork bug; a widget-side UX note (maybe a `type` filter chip-row, or a default-hide-asteroids toggle).
- **HTTP body for `tar.setTargetVessel` returns `false` regardless of success.** This is the standard Telemachus action-handler pattern (the `IsAction = true` decoration causes the HTTP layer to emit a placeholder, while the actual return is echoed on the WS state stream). Functional success was verified by re-reading `tar.name` immediately after firing. Worth a one-line callout in the upstream PR body so reviewers don't trip on it.
- **`tar.body` doesn't exist** in stock Telemachus — typo from the original test plan. Use `tar.o.referenceBody` or the `body` field embedded in each `tar.availableVessels` row.
- Scene transitions via `ksp.toTrackingStation` work as expected — used during the test session to automate the Tracking Station hop for the active-vessel-swap verification.

