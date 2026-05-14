# Atmospheric cluster — LandingStatus / AtmosphereProfile / ScienceBench / ShipMap

**Date:** 2026-05-14
**Validation:** ⏳ pending — landed and tested in CI (full suite green,
lint + typecheck clean). Not yet exercised against a live atmospheric
flight.

## What changed

Wired the unused `v.atmosphericDensity / atmosphericTemperature /
externalTemperature / indicatedAirSpeed / biome / solarFlux /
directSunlight / distanceToSun` keys into the four widgets that
benefit from ambient context. All keys were already on the wire from
the Telemachus fork; only schema, meta, and widget consumption were
missing.

### LandingStatus

New **Ambient** section appears below the existing predictions when:
1. the body is atmospheric (vacuum landings stay clean), and
2. there's room (`rows >= 9`).

Shows current air density (`v.atmosphericDensity`), air temperature
(`v.atmosphericTemperature`) and skin temperature
(`v.externalTemperature`) in human-readable units (kg/m³ → g/m³ →
exponential; Celsius for both temps). Density formatter handles the
1e-6 high-altitude tail without going to "0".

### AtmosphereProfile

Top-right live readout chip showing ρ / Air / Skin. Only renders when
the body has an atmosphere AND density is above ~1e-9 (so airless and
high-vacuum cases stay clean). Static profile + horizontal pressure
threshold are unchanged.

### ScienceBench

Subscribes to `v.biome`. The "where am I doing science" header now
prefers the live biome string over `v.landedAt`, with landedAt as
fallback. Same `ScienceUtil.GetExperimentBiome` source the game uses
to attribute new experiments — so an in-flight "FlyingHigh" /
"Splashed - OceanWater" reads correctly now, where it used to show
just the situation.

The experiment-record rows in the breakdown still use their own
per-record biome (the biome the experiment was *taken in* — different
concept from where the operator is now).

### ShipMap

Background tint behind the diagram driven by `v.externalTemperature`:

- `< 250 K`: subtle cold-blue ((290−T)/600 alpha, capped at 0.18)
- `250–320 K`: clear (ambient)
- `320–1500 K`: amber → red, alpha 0.08 → 0.25
- `> 1500 K`: red, alpha 0.25

CSS transition smooths the band so it ramps cleanly during a reentry
rather than flickering on tick boundaries. Per-part `therm.part[fid]`
tints render on top — they're more precise on the part-by-part heat
map.

## Wire shape recap (from fork)

`Telemachus/src/VesselDataHandlers.cs:149-230`:

- `v.atmosphericDensity` — kg/m³, `ds.vessel.atmDensity`.
- `v.atmosphericTemperature` — kelvin, ambient air temp.
- `v.externalTemperature` — kelvin, skin temperature including ram-air
  heating (diverges from atmospheric once the craft is moving).
- `v.indicatedAirSpeed` — m/s, IAS as seen by stock instruments.
- `v.solarFlux` — W/m², `ds.vessel.solarFlux`.
- `v.directSunlight` — bool, `Vessel.directSunlight`.
- `v.distanceToSun` — metres.
- `v.biome` — string, `ScienceUtil.GetExperimentBiome(mainBody, lat, lon)`.

Solar keys are wired into the schema and meta but not yet consumed by
a widget — they'll feed the future PowerSystems widget once the
`flow`/`nominalFlow` fork extension lands.

## Files

- `packages/core/src/schemas/telemachus.ts` — eight new keys
  (`v.atmosphericDensity / atmosphericTemperature / externalTemperature
  / indicatedAirSpeed / solarFlux / directSunlight / distanceToSun /
  biome`).
- `packages/data/src/types.ts` — `Unit` enum gains `kg/m³`, `K`, `W/m²`.
- `packages/data/src/schema/telemachusMeta.ts` — eight new meta
  entries with the new unit literals.
- `packages/components/src/LandingStatus/index.tsx` — Ambient section
  + formatters.
- `packages/components/src/AtmosphereProfile/index.tsx` — live readout
  chip.
- `packages/components/src/ScienceBench/index.tsx` — `v.biome` wired
  into the situation header.
- `packages/components/src/ShipMap/index.tsx` — `externalTempTint`
  mapping + DiagramWrap `::before` overlay.

## Validation checklist (next live session)

- Re-entry burn on Kerbin from low Mun orbit: ShipMap should fade from
  clear → amber → red as `v.externalTemperature` ramps. The
  per-part heat tints should still be visible against the warm band.
- LandingStatus Ambient section: visible on Kerbin / Eve, absent on
  Mun / Minmus / vacuum. Density readout should sweep through kg/m³
  → g/m³ → exponential as altitude drops.
- AtmosphereProfile chip: appears mid-descent on Kerbin, disappears
  once above the atmosphere ceiling.
- ScienceBench: header reads "FLYING HIGH — Mountains" (or similar)
  during atmospheric flight, falls back to landedAt when on the
  surface.
- **Open question from the doc** — does `v.externalTemperature`
  diverge meaningfully from `therm.hottestPartTemp`? If they track too
  closely the ShipMap tint adds less than expected. Watch them
  side-by-side during a hot reentry.

## What didn't ship

Solar keys (`v.solarFlux / directSunlight / distanceToSun`) are wired
into the schema + meta but await the PowerSystems widget, which is
gated on the `flow`/`nominalFlow` `r.resourceFor` fork extension.

Next item from the followups doc: body data — rotation animation,
atmosphere gradient, description.
