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

KSP restart required before any of this works.

- **Solar panels**: deploy a panel, confirm PowerSystems shows a
  positive ElectricCharge producer row with efficiency below 100% when
  off-angle, near 100% sunlit and aligned.
- **RTG**: an RTG-bearing probe should show a constant ~0.75
  ElectricCharge producer with efficiency ~100%. The RTG part itself
  has no EC storage, so the row's stored should read 0.
- **ISRU**: run an ISRU converter with Ore input. Confirm Ore appears
  as a negative consumer row, the output (LF/Ox/Mono) as positive
  producer rows. Efficiency reflects `lastTimeFactor`.
- **Drill**: extract Ore on a planet with `OreAbundance > 0`. Should
  show Ore as a positive producer at the harvester.
- **Engine**: ignite an engine. Confirm LiquidFuel + Oxidizer (or
  appropriate propellant) consumers appear at the engine, with
  efficiency suppressed (nominal not emitted).
- **ShipMap ring**: every producer/consumer part should have a
  green/amber ring respectively. Highlighted (hot) parts keep their
  amber highlight ring as dominant.
- **Net behaviour**: a coasting probe (RTG + life-support) should show
  a positive net; an active flight (engine + RCS) should show negative
  net.

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
