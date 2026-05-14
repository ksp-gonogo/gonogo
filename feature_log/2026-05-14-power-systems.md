# Power Systems — flow / nominalFlow + producers/consumers widget

**Date:** 2026-05-14
**Validation:** ⏳ pending — landed and tested in CI (full suite green,
lint + typecheck clean). Telemachus DLL rebuilt + synced; KSP restart
required to load. Live coverage across all five module types still
needs a flight with each (solar arrays, RTG, ISRU, drill, engine).

## What changed

The last item from the 2026-05-14 audit follow-up doc. Extends the
per-part live-resource handler with signed flow contributions and ships
a new widget that aggregates them into producers / consumers totals.

### Fork (Telemachus.dll, on `telemachus/parts-topology`)

`Telemachus/src/ResourceHandlers.cs` — `r.resourceFor[flightId]` now
returns `flow` and `nominalFlow` alongside `amount` / `maxAmount`:

```ts
{
  [resourceName: string]: {
    amount: number;
    maxAmount: number;
    flow?: number;        // signed units/sec, summed across modules
    nominalFlow?: number; // 100%-efficiency cap, same sign
  };
}
```

Module dispatch in a single switch:

| Module | Current rate | Nominal cap |
|---|---|---|
| `ModuleDeployableSolarPanel` | `flowRate` | `chargeRate × efficiencyMult` |
| `ModuleGenerator` (RTGs / fuel cells) | `output.rate × efficiency` (signed) | `output.rate` |
| `ModuleResourceConverter` (ISRU + `ModuleResourceHarvester` inherits) | `Ratio × lastTimeFactor` (signed by output / input) | `Ratio` |
| `ModuleEngines` (`ModuleEnginesFX` inherits) | `−propellants[].currentRequirement` | omitted (varies with throttle) |

Engines mark the row's nominal as **incomplete**, so the client
suppresses `nominalFlow` whenever an engine contributes — keeps the
total nominal honest. Per-module dispatch wrapped in try/catch so one
bad module doesn't crater the whole response.

Rows are emitted for resources a part contributes flow to even when the
part stores none (RTG → `{ ElectricCharge: { amount: 0, maxAmount: 0,
flow: 0.75, nominalFlow: 0.75 } }`).

Commit: `aab442b feat(resource): r.resourceFor — flow + nominalFlow per resource`
on `telemachus/parts-topology`.

### Client schema (`@gonogo/core`)

`PartResources[resourceName]` gains optional `flow` and `nominalFlow`
fields with the same semantics as the fork wire shape.

### `@gonogo/components/PowerSystems` — new widget

`packages/components/src/PowerSystems/index.tsx`. Walks the topology
(via `useTopology`) and `usePartsLive(flightIds)`, then for the
selected resource:

- Picker shows every resource with a live `flow` contribution; cycles
  via the `cycleResource` button action.
- Top row: net rate (green for positive, amber for net drain),
  total produced, total consumed, total stored.
- Two scrolling sections: Producers and Consumers, sorted by
  magnitude. Per-row efficiency shown as `flow / nominalFlow` when
  both present.
- Compact mode (small widget size): collapses to "POWER · <resource> ·
  net rate".
- Default resource is ElectricCharge; config component exposes a
  text-input override.
- Pre-data states: "Waiting for vessel topology…" while topology hasn't
  arrived; "No active flow on any resource" while resources have
  arrived but nothing is producing / consuming yet.

Registered in `packages/components/src/index.ts` alongside the existing
exports.

### ShipMap producer / consumer ring

`packages/components/src/ShipMap/shipTopology.ts` — `ShipMapPart` gains
`ecFlowSign: "producer" | "consumer" | null` derived from
`resources.ElectricCharge.flow`. Threshold ±1e-6 to skip noise.

`packages/components/src/ShipMap/ShipDiagram.tsx` — when a part has a
flow sign and isn't the hottest, render a thin coloured ring outside
the part box (subtle green for producer, amber for consumer) at 50%
opacity so per-part thermal tints + the hot-part highlight remain the
dominant signals. EC only in v1; other resources can be opt-in later.

## Files

- `local_docs/telemachus-fork/Telemachus/src/ResourceHandlers.cs` —
  extended handler with module dispatch + FlowRow accumulator.
- `local_docs/syncthing/kspdata/GameData/Telemachus/Plugins/Telemachus.dll`
  — rebuilt and synced.
- `packages/core/src/schemas/telemachus.ts` — `PartResources` extended.
- `packages/components/src/PowerSystems/index.tsx` — new widget.
- `packages/components/src/index.ts` — register PowerSystems export.
- `packages/components/src/ShipMap/shipTopology.ts` — `ecFlowSign`
  derivation.
- `packages/components/src/ShipMap/ShipDiagram.tsx` — flow-sign ring.

## Validation checklist (next live session)

**Prerequisite:** restart KSP. The synced DLL only loads at boot.

### Step 1 — pick a flightId to probe

`r.resourceFor` is keyed by flightId. Pull the topology to find live
ones for the parts you care about:

```bash
./scripts/gonogo_claude_tools.sh tele read v.topology | jq '.["v.topology"].parts[] | {flightId, name, modules}'
```

Note the flightIds for: a solar panel, an RTG, an ISRU, a drill, an
engine, and a fuel tank (control case — should have storage but no
flow).

### Step 2 — verify each module type via the fork API

For each part:

```bash
./scripts/gonogo_claude_tools.sh tele read 'r.resourceFor[<flightId>]'
```

Expected shapes per module:

- **Fuel tank** (control): `{ LiquidFuel: { amount: N, maxAmount: N } }`.
  No `flow`, no `nominalFlow` — confirms a part with no contributing
  modules stays clean.
- **Solar panel** (extended, sun-aligned): `{ ElectricCharge: {
  amount: 0, maxAmount: 0, flow: 0.75, nominalFlow: 0.75 } }` (sunlit
  ≈ nominal). Off-angle or in shadow: `flow < nominalFlow`. Stowed:
  `flow ≈ 0`, `nominalFlow` is still the panel's max.
- **RTG**: `{ ElectricCharge: { amount: 0, maxAmount: 0, flow: 0.75,
  nominalFlow: 0.75 } }`. RTGs have no storage so amount/maxAmount = 0;
  flow == nominalFlow so `nominalFlow` should actually be **omitted**
  in the wire payload (`Math.abs(nominal − flow) < 1e-9` rule).
- **ISRU** (running, Ore→LFO): `{ Ore: { amount: 0, maxAmount: 0,
  flow: -2.5, nominalFlow: -3.0 }, LiquidFuel: { amount: 0, maxAmount:
  0, flow: 1.25, nominalFlow: 1.5 }, Oxidizer: { flow: 1.5,
  nominalFlow: 1.8 }, ElectricCharge: { flow: -15, nominalFlow: -30 }
  }` — exact numbers vary; what matters is **inputs are negative**,
  **outputs are positive**, and `flow / nominalFlow` ≈ `lastTimeFactor`
  (rendered ≈ 0.85 when at 85% efficiency).
- **Drill** (extracting Ore at OreAbundance > 0): `{ Ore: { amount: 0,
  maxAmount: 0, flow: +R, nominalFlow: +Rmax }, ElectricCharge: { flow:
  -K, nominalFlow: -Kmax } }` — positive Ore, negative EC. Inactive
  drill: rows absent.
- **Engine** (ignited at full throttle): `{ LiquidFuel: { amount: 0,
  maxAmount: 0, flow: -3.5 }, Oxidizer: { flow: -4.3 } }`. `nominalFlow`
  must be **omitted** for engine-contributed rows because the v1 fork
  marks it as incomplete. Engine off: rows absent.

Watch for: **`nominalFlow` always shares the sign of `flow`**. If a
row reports `flow: -2` and `nominalFlow: +2` something's wrong with
the sign convention.

### Step 3 — widget exercise (PowerSystems)

Add the **Power Systems** widget to the dashboard.

- **Solar panels**: deploy a panel; the EC chart should switch from
  "net negative" (probe drain) to "net positive". Per-row efficiency
  should swing with sun angle.
- **RTG**: a probe with RTG + life support draws should show RTG in
  Producers, command pod in Consumers. Net positive (RTG outpaces
  consumers).
- **ISRU**: run a converter; resource picker should now offer Ore /
  LF / Ox / Mono / EC depending on what's running. Switching to Ore
  shows a negative net (being consumed), LF a positive net (being
  produced).
- **Drill**: extract Ore; widget picker offers Ore; net positive.
- **Engine**: ignite an engine; widget picker offers LF / Ox / Mono /
  SolidFuel etc.; engine rows appear under Consumers, no efficiency
  shown (nominal omitted by the fork).
- **Compact mode**: shrink the widget to ≤ 5 cols or ≤ 7 rows; it
  should collapse to the single "POWER · <resource> · net" line.
- **No-flow state**: with everything stowed/off on the launchpad
  (just a probe core idle), the empty-state message "No active flow
  on any resource" should appear.
- **`cycleResource` action** (if you've mapped a button input):
  pressing it should walk through every resource in the
  resources-with-flow set.

### Step 4 — widget exercise (ShipMap producer / consumer ring)

Open the Ship Map widget alongside Power Systems on the same vessel:

- Producer parts (deployed solar, active RTG, active ISRU's EC
  output if applicable) should show a thin green ring.
- Consumer parts (command pod, running engine, ISRU's EC input,
  drill, active light banks) should show a thin amber ring.
- Hot parts (the `therm.hottestPartName` highlight) keep their
  amber **highlight** ring as the dominant visual.
- Inactive parts: no ring.
- The ring tracks EC only in v1 — toggling between resources in
  Power Systems doesn't change the Ship Map ring.

### Step 5 — net behaviour sanity checks

- Coasting probe (RTG + probe core drain): Power Systems net should
  be slightly positive, stored EC slowly climbing.
- Active flight (engine ignited): the engine resources show a net
  negative on whatever propellant the engine uses.
- Stage separation: after staging, the parts list should shrink
  (decoupled stage drops out of `v.topology`), and stale producers /
  consumers should disappear within one topology refresh.

## Why this matters

- One less reason to crack open the in-game F12 menu. Power balance is
  the kind of thing players spend a lot of time worrying about during
  craft design and reentry planning.
- Unblocks future widgets — heat economy, fuel-flow diagnostics,
  per-stage ΔV budgets that account for boil-off. They can all use
  the same flow infrastructure.
- Closes out the 2026-05-14 audit. All five suggested items from
  `local_docs/telemachus_api_followups_2026-05-14.md` have shipped
  (modulo live validation).

## What didn't ship

- Per-resource ShipMap tinting beyond EC. The data is there; widget
  config to pick which resource drives the ring is a follow-up.
- Engines `nominalFlow`. At full throttle, omitting nominal is fine
  (it equals flow). For partial-throttle nominal we'd need to
  integrate `maxFuelFlow` × propellant ratio × density — out of v1
  scope.
- Mod resources (LiquidHydrogen on Cryogenic Engines etc). They should
  Just Work through the generic module dispatch, but won't have
  curated metadata in the resource picker until someone wires them.
