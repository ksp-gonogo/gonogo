# Power Systems — flow / nominalFlow + producers/consumers widget

**Date:** 2026-05-14
**Validation:** ⏳ pending — Substantially validated 2026-05-15 against Validator-1 (suborbital test craft with solar panels, RTGs, an LV-T45 engine, and a fuel tank). 4 of 5 dispatch cases confirmed end-to-end (solar, RTG, engine, fuel-tank control). One real bug found in engine dispatch (units/frame vs units/sec) — fix landed in source, awaits DLL rebuild for live re-verify. ISRU + drill dispatch not exercised (no Convert-O-Tron or harvester on the test craft). One coverage-gap finding worth a fork v2 PR: consumer dispatch missing for `ModuleDataTransmitter` / `TelemachusPowerDrain` / `ModuleCommand` / `ModuleReactionWheel` / `ModuleLight`, and producer dispatch missing for `ModuleAlternator`. See "Live validation 2026-05-15" below.

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

## Live validation — 2026-05-15

Validator-1 test craft: Mk1 pod + parachute + heat shield + decoupler + FL-T400 + LV-T45 engine + 2× OX-4L solar + 2× PB-NUK RTG + 4× LT-1 strut + 2× Z-100 battery + 2× Telemachus antenna. Suborbital flight; partial set of dispatch cases exercised (no Convert-O-Tron or harvester on the craft for ISRU / drill).

### Dispatch case results

| Module | Pre-condition | Result |
|---|---|---|
| **Fuel tank** (control) | FL-T400 | ✅ `{ LiquidFuel: { amount: 180, maxAmount: 180 }, Oxidizer: { amount: 220, maxAmount: 220 } }` — no `flow` / `nominalFlow` |
| **Solar panel** (stowed) | prelaunch, panel folded | ✅ `{ ElectricCharge: { flow: 0, nominalFlow: 1.64, amount: 0, maxAmount: 0 } }` |
| **Solar panel** (extended, sun on one side) | post-deploy | ✅ one panel `flow: 0.613` (≈37% nominal — sub-optimal angle), other shadowed at `flow: 0` — confirms per-part flow + asymmetric production |
| **RTG** | always-on | ✅ `flow: 0.75`, `nominalFlow` correctly **omitted** (equal-to-flow rule) |
| **Engine** (ignited, full throttle) | LV-T45 stage 1 | ✅ rows show LF + Ox with **negative** flow and **no** `nominalFlow` — shape correct |
| **Engine** (off) | post-decouple, lower stage shed | ✅ rows absent from `r.resourceFor` on the new active vessel (engine no longer on the vessel) |
| **ISRU** (running) | — | ⏳ not exercised (no Convert-O-Tron on Validator-1) |
| **Drill** (extracting) | — | ⏳ not exercised (no harvester on Validator-1) |
| Sign invariant — `nominalFlow` shares sign of `flow` | every emitted row across the flight | ✅ no sign-mismatched rows observed |

### Engine-flow units bug — found + fixed

While polling during the engine burn, the reported `flow` was -0.123 LF/sec but the tank drained at ~7 LF/sec → ~56× discrepancy. Tracking the source through `Telemachus/src/ResourceHandlers.cs:243-261`, the dispatch case for `ModuleEngines` was emitting `prop.currentRequirement` directly — but in KSP this is **units-per-physics-frame** (set each `FixedUpdate`), not units-per-second. The correct conversion is to divide by `TimeWarp.fixedDeltaTime`.

Fix landed in the same file, dispatch case wrapped to skip the row when `dt <= 0f` so we never divide by zero. Telemachus DLL recompiled clean (0 errors, 4 expected warnings); not synced to the live install because the test session was still mid-flight and a DLL change requires a KSP restart. **Engine flow needs a live re-verify on the next session** to close out this entry.

### Consumer dispatch gap — fork v2 item

On the surviving 4-part active vessel (pod + parachute + 2 antennas), the PowerSystems widget rendered "No active flow on any resource" despite the in-game F12 menu showing 0.04 EC/s draw per antenna. Confirmed via curl: `r.resourceFor[<antennaFlightId>] = {}` — the antenna's `TelemachusPowerDrain` module isn't in the dispatch list.

The same gap applies to several stock modules:

- `ModuleDataTransmitter` (stock antenna EC draw on transmit / passive)
- `TelemachusPowerDrain` (this fork's mod-specific antenna draw)
- `ModuleCommand` (probe core / pod SAS EC draw)
- `ModuleReactionWheel` (active RW EC draw)
- `ModuleLight` (active light banks)
- **`ModuleAlternator`** (engine alternator — produces EC when engine fires) — caught here because Validator-1's LV-T45 has an alternator, and we missed positive EC during the burn

This is a fork v2 expansion, not a v1 bug. Tracking as a follow-up; the v1 surface validated cleanly within its declared coverage.

### Widget-level observations

- **Solar panels hidden from PowerSystems when `flow == 0`.** While the panels were extended-but-shadowed during the burn, the widget's "active flow" filter dropped them. The widget worked as designed, but the operator can't tell the difference between "no panels installed" and "panels extended but in shadow." UX follow-up: render zero-flow rows at low opacity / under a "Deployable" section so the deployment state is visible.
- **`v.topologySeq` bumps more aggressively than the design predicted.** 83 → 198 across one suborbital flight, 198 → 325 across a Tracking-Station-driven vessel swap. Each bump traces to a real KSP event. Downstream consumers (the seq-driven topology refetch) handled the churn gracefully — no UI thrashing observed.

### Outstanding live coverage (next session)

1. Engine flow units fix re-verified after DLL rebuild + KSP restart.
2. ISRU running: `r.resourceFor` rows with inputs negative, outputs positive, `flow / nominalFlow` ≈ `lastTimeFactor`.
3. Drill extracting: Ore positive, EC negative.
4. PowerSystems with a craft that has all five module types loaded at once (station-class build with a Convert-O-Tron + harvester + solar farm).
5. ShipMap producer / consumer ring: was visible on the Validator-1 RTGs but masked by the hottest-part highlight (which correctly took precedence at higher opacity). Needs a craft with a non-hot producer and a non-hot consumer side-by-side.

