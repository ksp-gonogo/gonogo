# Built-in widget survey: does anything in `packages/components/` belong in an Uplink?

Date: 2026-09-06
Scope: every widget directory under `packages/components/src/`
Branch: `worktree-agent-a27889a48579a70cd`, base `de0547415`

## Verdict

**Clean negative on the primary question.** No widget in `packages/components/src/`
reads an Uplink-owned topic namespace from production code. Not one `rp1.*`,
`kerbalism.*`, `realantennas.*`, `principia.*`, `realfuels.*`, `mechjeb.*`,
`far.*`/`aero.*`, `kos.*`, `testflight.*` or `scansat.*` read exists outside a
fixture or a test.

Two residues and one instrument gap came out of the walk, none of them a widget
that needs moving:

1. `packages/components/src/ShipSystems/` holds `__fixtures__/` and nothing else.
   The widget itself already lives in `mod/GonogoKerbalismUplink/client/src/ShipSystems`.
   **These fixtures must travel with the Kerbalism Uplink when it leaves the repo**
2. `packages/app/src/__tests__/uplink-widget-declarations.test.ts:167` lists
   `space-weather` under "the built-in widgets". That widget moved to the
   Kerbalism Uplink; the label is stale, the assertion still passes because it
   only checks the id is registered
3. `ModToken` in `packages/core/src/uplink-boundary.allowlist.ts` has no token
   for **RP-1**, **RealFuels** or **Breaking Ground**, so the boundary ratchet
   cannot see coupling to those three anywhere in `packages/`

The negative is worth more than it looks, because this is not a tree that was
merely never violated: five widgets have already been moved out
(`deployed-science`, `robotics-console`, `rotor-tachometer` to Breaking Ground,
`kos-terminal` to kOS, `space-weather` and `ship-systems` to Kerbalism). The
convention is live and it is being applied.

## Method, and why one instrument was not enough

Three passes, because the obvious one is blind in a way that matters.

**Pass 1 — string literals across the whole directory.** Flagged `kerbalism` in
five widgets, `realantennas` in one, `rp1` in two. All false. Every hit was in a
`__fixtures__/*.json`, a `*.test.tsx`, or a `__render_*__/` probe fixture:
install profiles that *describe* a modded install so the widget can be proven to
render on a stock one.

**Pass 2 — production files only** (`! -name '*.test.*' ! -path '*__fixtures__*'`).
This is the table below. Zero Uplink namespaces survive.

**Pass 3 — the literal-string blind spot.** A `useTelemetry` call whose topic is
computed reads nothing a grep for `"kerbalism."` can see. One such call site
exists in the whole package:

```
packages/components/src/MapView/MapPoiLayer.tsx:243
  const availabilityTopic = (
    provider.requires ? `${provider.requires}.available` : ""
  ) as TopicId;
```

That is the generic Domain presence gate, keyed off whatever a registered POI
provider declared. MapView names no mod; the only built-in provider is
`MapView/vanillaPoiProvider.ts`. This is the pattern working, not a hole.

The classification of "base" vs "Uplink-owned" is not judgement:
`mod/sitrep-sdk/src/__generated__/topic-map.ts` is the base topic list and
contains **zero** Uplink-namespace ids, while each Uplink ships its own
`client/src/__generated__/topic-map.ts`. So "is this namespace in the base map"
is a decidable question and every row below was decided that way.

## The table

43 widgets are exported from `packages/components/src/index.ts`. Namespaces are
what the production files actually reference; commands and contribution-slot ids
are marked because they are not topic reads.

| Widget | Namespaces read (production only) | Verdict |
|---|---|---|
| ActionGroup | `vessel.*`, `comms.link`, `time.warp` | built-in |
| AstronautComplex | `spaceCenter.*`, `career.*` (+ `career.crew.hire/fire` cmds) | built-in |
| AtmosphereProfile | `vessel.*`, `system.bodies` | built-in |
| CareerEconomy | `career.status.economy.*` | built-in |
| CommSignal | `comms.*`, `vessel.comms`, `vessel.state` | **augmented** (RealAntennas) |
| ContractManager | `career.*` (+ `career.contract.*` cmds), `vessel.state` | built-in |
| CrewStatus | `vessel.crew`, `vessel.resources`, `vessel.state` | **augmented** (Kerbalism, `crew-status.survival`) |
| CurrentOrbit | `vessel.orbit`, `vessel.state`, `system.*` | built-in |
| DataSourceStatus | none (registry state) | built-in |
| EscapeProfile | `vessel.state`, `system.bodies` | built-in |
| Experiments | `science.*` (+ `experiments.*` slot ids) | built-in |
| FleetComms | `comms.link` | built-in |
| FleetReliability | `reliability.*`, `vessel.*` | **augmented** (elected backend) |
| FleetRoster | `system.*`, `commandCentre.roster` | built-in |
| FuelStatus | `dv.*`, `vessel.*` | built-in |
| Graph | none (config-driven series) | built-in |
| KeplerPeriod | `vessel.orbit`, `vessel.state`, `system.bodies` | built-in |
| LandingStatus | `vessel.*`, `comms.delay`, `dv.*`, `system.bodies` | built-in |
| LaunchDirector | `spaceCenter.*`, `ksp.*`, `career.*`, `crash.*`, `vessel.*`, `target.available` | **augmented** (RP-1, `launch-director.pad`) |
| LibrationPoints | `vessel.*`, `system.bodies` | built-in |
| ManeuverPlanner | `vessel.*` (+ `vessel.maneuver.*` cmds), `dv.stages`, `system.frame` | built-in |
| MapView | `vessel.*`, `system.bodies`, `spaceCenter.pois` | **augmented** (POI providers, generic gate) |
| Navball | `vessel.attitude`, `vessel.control`, `comms.delay` | built-in |
| Objectives | `career.status` (+ `objectives.source` slot) | built-in |
| OrbitalAscent | `vessel.state`, `system.bodies` | built-in |
| OrbitView | `vessel.orbit`, `vessel.state`, `system.*` | built-in |
| PerfBudgets | none (local registry) | built-in |
| PowerSystems | `vessel.parts`, `vessel.resources`, `parts.power` | built-in |
| ResourceOps | `isru.converters`, `isru.drills`, `vessel.identity`, `system.bodies` | built-in |
| ScienceData | `science.*`, `career.*`, `vessel.*` | built-in |
| SemiMajorAxis | `vessel.orbit`, `vessel.state`, `system.frame` | built-in |
| ShipMap | `vessel.parts`, `vessel.thermal`, `vessel.flight`, `vessel.control` | **augmented** (Kerbalism, `ship-map.part-meters`) |
| SpaceCenterStatus | `career.*` (+ `career.facility.upgrade` cmd), `spaceCenter.*` | **augmented** (RP-1, via command gate) |
| StationConnectView | none (PeerJS state) | built-in |
| Strategies | `career.*` (+ `career.strategy.*` cmds, `strategies.screens` slot) | **augmented** (RP-1 screens) |
| SystemView | `system.*`, `comms.network`, `vessel.*` | built-in |
| Targeting | `vessel.target`, `vessel.dock` (+ `targeting.camera/overlay` slots) | **augmented** (camera, unnamed) |
| TargetPicker | `vessel.target`, `target.available` | built-in |
| TechTree | `career.*` (+ `career.tech.unlock` cmd), `spaceCenter.scene` | built-in |
| ThermalStatus | `vessel.thermal` | built-in |
| TransferWindow | `vessel.orbit`, `dv.summary`, `system.bodies`, `target.available` | built-in |
| Twr | `vessel.state.twr` | built-in |
| WarpControl | `time.warp` (+ `time.setWarpIndex`/`time.setPaused` cmds) | built-in |

Not exported, and therefore not widgets: `Plots/` (internal to Graph), `shared/`,
`test/`. `ShipSystems/` is fixtures only, see below.

`isru.*`, `parts.power`, `reliability.*`, `commandCentre.roster`, `crash.*` and
`ksp.*` all appear in the base generated topic map, so none of them is an Uplink
namespace wearing a base-looking name. `reliability.*` is the one worth stating
explicitly, because it reads like a mod's word.

## The interesting middle, worked

Nine widgets sit in the augmented band. Each was checked rather than assumed.

**`reliability.*` is CORE-owned, not TestFlight's.**
`mod/Gonogo.KSP/ReliabilityCoreUplink.cs` owns the exclusive `reliability`
capability, declares both channels once, and registers `NoneReliabilityBackend`
as an always-present vanilla factory. Kerbalism (priority 1) and TestFlight
(priority 10) register as *backends* from their own Uplinks and declare no
channels. Election happens in the Kernel, never in the client. So
`FleetReliability` consumes one shape from a namespace that exists on a stock
install. Its module doc is explicit that `coverage: "none"` renders blank
deliberately, and `coverage-matrix.test.tsx` fails if any two absence states
read alike. Correct where it is.

**`SpaceCenterStatus` gates on a verdict, not on a mod name.** It reads
`upgradeCmd.gate?.blocked` (index.tsx:228) — a generic command-gate result. It
never reads `rp1.*`. `Rp1CareerProjectGate` is named once, in a comment
explaining why the affordability copy is suppressed when the gate blocks. This
is the spending rule from CLAUDE.md applied correctly: under RP-1 a facility
upgrade is a progressive spend, so "cannot afford" would be a falsehood, and the
widget declines to draw a money verdict where money is not what decides.
`spend-truth.test.tsx` is the ratchet.

**`LaunchDirector` proves vanilla is not a degraded mode.** Its
`install-profiles.test.tsx` renders the same pre-launch scene under
`stock-career` and under `rp1-kerbalism-live`, and states the claim outright:
pad existence is `spaceCenter.launchSites`, occupancy is
`padOccupied`/`padVesselTitle` on the same entries, and what RP-1 knows about a
pad reaches the row through the `launch-director.pad` slot, which this package
cannot load. The two renders differ only in the pads.

**`Strategies` is the cleanest statement of the model in the tree.**
`screens.ts` puts it plainly: a facility's screens belong to the elected career
model rather than to the widget, so the screen list arrives as a contribution,
computed from Topics and therefore deterministic. An empty contribution draws the
ungrouped widget rather than a broken tab strip, and `strategies.unclaimed`
catches everything no contributed screen claims so a partial contributor cannot
silently hide sixty rows.

**`ResourceOps` has a `vanilla-stock.json` fixture** alongside its two Kerbalism
ones. `isru.converters`/`isru.drills` are stock ISRU. Fine.

**`CommSignal`** is the brief's own worked example and it holds: ten fixtures,
nine stock, one `realantennas-link.json`.

`CrewStatus`, `ShipMap`, `MapView` and `Targeting` all follow the same shape —
built-in widget owns the slot, Uplink fills it. Confirmed by counting slot-id
references in `mod/`: 26 in GonogoKerbalismUplink, 2 in GonogoRp1Uplink, 1 in
GonogoRealAntennasUplink. All the filling lives on the Uplink side.

No widget declares a mod presence requirement. `requires` across the whole
package is only `["flight"]` or `["career"]` — never a Domain.

## Residues

### 1. `ShipSystems/__fixtures__/` — move it with the Uplink

`packages/components/src/ShipSystems/` contains three fixture JSONs and no
production file. The widget is `mod/GonogoKerbalismUplink/client/src/ShipSystems`.
The reason is recorded at `packages/components/scripts/widgets.ts:1746`:

> the fixture stays under `packages/components/src/ShipSystems/__fixtures__`
> purely because `fixturesPath` resolves against `packages/components/src/`

That is an honest note about a harness limitation, and it was harmless while both
halves were in one repo. **It stops being harmless the moment the Kerbalism
Uplink leaves.** The `ship-systems` entry in `widgets.ts` points at a path in
`packages/components`; the widget it renders will be in `gonogo-uplinks`. Either
the render entry follows the widget (as `kos-terminal` and `space-weather` already
did, each taking its fixtures into the Uplink's own `__fixtures__/`) or the
fixtures are orphaned in this repo with nothing rendering them.

The prior moves show the shape of the fix, so this is small: relocate the three
JSONs into the Uplink's `__fixtures__/` and delete the `widgets.ts` entry, exactly
as the `kos-terminal` and `space-weather` comments describe. Doing it before the
migration is one commit in one repo. Doing it after is a coordinated change across
two.

Same class, lower stakes: `CrewStatus/__render_kerbalism_survival__/` holds two
synthetic probe fixtures for the Kerbalism `CrewSurvival` augment. Those are
arguably correct where they are (they drive a *built-in* widget's slot and prove
the host renders the augment), but they are Kerbalism-shaped input sitting in the
base package and are worth a deliberate decision rather than an accident.

### 2. A stale label in the app's declaration guard

`packages/app/src/__tests__/uplink-widget-declarations.test.ts` splits its
coverage into "the Uplinks' own widgets" (`avionics-go-no-go`, `robotics-console`,
`ship-systems`, `kos-terminal`, `mechjeb`) and "the built-in widgets"
(`space-weather`, `crew-status`, `ship-map`). `space-weather` moved to the
Kerbalism Uplink and is in the wrong group. The test still passes because it only
checks the id registered, so nothing catches it. Comment accuracy only, no
behaviour change — but this file is precisely the one a reader consults to learn
which half a widget belongs to.

### 3. Instrument gap: three mods have no `ModToken`

`packages/core/src/uplink-boundary.allowlist.ts` defines twelve tokens:
`kerbcast`, `scansat`, `kos`, `realantennas`, `agx`, `mechjeb`, `avionics`,
`kerbalism`, `testflight`, `principia`, `ferram`, `realsolarsystem`.

Missing, each with a shipped Uplink or a live namespace:

- **RP-1** (`mod/GonogoRp1Uplink`) — 77 files under `packages/*/src` and
  `packages/*/scripts` mention it
- **RealFuels** (`mod/GonogoRealFuelsUplink`) — 6 files
- **Breaking Ground** (`mod/GonogoBreakingGroundUplink`, `robotics.*`,
  `deployed.*`) — 11 files

I sampled the RP-1 hits in `packages/components` production code
(`SpaceCenterStatus/index.tsx`, `Strategies/screens.ts`, `AstronautComplex/index.tsx`,
`shared/streamBody.ts`, `shared/KerbalStats.tsx`) and every one is a comment
explaining *why* the code is source-agnostic — the `permanent` bucket, not
`domainDebt`. **So this is an unwatched surface, not existing debt.** But the
allowlist's own header records that `realsolarsystem` earned a token exactly this
way: by being missed, while `packages/core/src/rss-bodies.ts` sat in core for
eleven days holding a planet pack's body table. The same shape is available today
for RP-1, and the gate could not express an objection to it.

Adding a token is a reviewed edit plus a `permanent` seeding pass over ~77 files.
Not free, and out of scope for a survey — flagged as a decision, not filed.

## Why the timing matters

Eleven Uplinks are migrating out to `gonogo-uplinks` as this is written. Nothing
in the table needs to move, so the migration is not blocked and no widget is about
to become a cross-repo problem.

The one item that *does* cross the boundary is the `ShipSystems` fixture set,
which is currently a `packages/components` path feeding a `mod/GonogoKerbalismUplink`
widget. That coupling is invisible today and becomes a cross-repo coupling the
moment Kerbalism leaves. It is cheap now and awkward later, and it is the only
thing in this survey with a deadline attached to it.

The `ModToken` gap has no deadline but gets harder in the same direction: once an
Uplink lives in another repo, the boundary ratchet in *this* repo is the only
thing standing between `packages/` and a mod-coupled line, and for RP-1,
RealFuels and Breaking Ground it is not standing there at all.

## Appendix: reproducing the walk

```sh
# Pass 2, the table. Production files only.
for d in packages/components/src/*/; do
  n=$(basename "$d"); case "$n" in shared|test) continue;; esac
  files=$(find "$d" -type f \( -name '*.ts' -o -name '*.tsx' \) \
    ! -name '*.test.*' ! -name '*.test-d.*' ! -path '*__fixtures__*')
  [ -z "$files" ] && { echo "=== $n === (NO PRODUCTION FILES)"; continue; }
  echo "=== $n ==="
  echo $files | tr ' ' '\n' | xargs grep -hoE "['\"][a-z][a-zA-Z0-9]*\.[a-zA-Z0-9_.]+['\"]" \
    | tr -d "'\"" | sort -u | tr '\n' ' '; echo
done

# The finding query. Every hit is a fixture or a test.
grep -rnoE "['\"](rp1|kerbalism|realantennas|principia|realfuels|mechjeb|far|aero|kos|testflight|scansat)\.[a-zA-Z0-9_.]+['\"]" \
  packages/components/src/

# Pass 3, the blind spot. One hit, and it is the generic gate.
grep -rnE "useTelemetry\(\s*[^\"')]" packages/components/src/ --include='*.tsx' --include='*.ts'

# The base topic list, which decides "base" vs "Uplink-owned".
grep -oE '"[a-z][a-zA-Z0-9.]+"' mod/sitrep-sdk/src/__generated__/topic-map.ts | sort -u
```
