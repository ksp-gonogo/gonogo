# Encounter + next-apsis chips: TargetPicker / MapView / SystemView

**Date:** 2026-05-14
**Validation:** ⏳ pending: landed and tested in CI (full suite green, lint
+ typecheck clean). Not yet exercised against a live KSP flight that
crosses an SOI boundary.

## What changed

Wired the unused `o.encounter*` / `o.nextApsis*` keys into three flight
widgets. All keys were already on the wire from the Telemachus fork (no
server-side change needed); only the schema, meta, and widget consumption
were missing.

New shared chip component `packages/components/src/shared/OrbitalEventChips.tsx`
renders a row with two optional chips:

- **ENC / ESCAPE**: body + countdown to SOI transition.
- **NEXT**: `Pe` or `Ap` + countdown.

Renders nothing when neither has data, so the host header collapses in the
common steady-orbit case.

### TargetPicker

`OrbitalEventChips` placed below `PickerHeader`, visible across tabs. New
`OrbitalEventChipsRow` wrapper uses `&:empty { display: none }` so the
chip area doesn't reserve vertical space when there's nothing to show.

### MapView

`OrbitalEventChips` placed in the header alongside the imaging chip / follow
toggle (gated behind `showImagingChip`, so the compact branch stays clean).

Plus a world-space marker on the prediction overlay: `predictGroundTrack`
already terminates on `patch.referenceBody` mismatch, so the last sample
of the last non-empty `predictionSegments` entry **is** the ground track at
SOI transition. The marker is a thin ring (blue for encounter, amber for
escape) with a centred dot for legibility at low zoom. Same `adjustedMap`
projection as the impact-X marker.

### SystemView

`AlmanacPanel` gained four optional props: `encounterDirection`,
`encounterTimeSec`, `nextApsisType`, `nextApsisTimeSec`. The
`SystemViewComponent` only passes through `encounterDirection` when the
panel body matches `o.encounterBody` (so the chip only fires on the right
card), and the next-apsis row is gated inside the panel on `isVesselParent`
because apsides only make sense relative to the vessel's parent.

## Wire shape recap (from fork)

`Telemachus/src/VesselDataHandlers.cs:443-531`:

- `o.encounterExists`: int. `-1` = escape (leaving current SOI), `0` =
  none, `1` = encounter (entering another body's SOI).
- `o.encounterBody`: string. For ENCOUNTER: the next patch's reference
  body. For ESCAPE: the *grandparent* (escaping Mun's SOI returns
  `"Kerbin"`). Empty string when none.
- `o.encounterTime`: already a delta (seconds until transition), not an
  absolute UT. Returns `-1` sentinel when no transition.
- `o.UTsoi`: absolute UT of the transition. Not currently read by any
  widget; surfaced in the schema for future use.
- `o.nextApsisType`: `-1` = Pe, `1` = Ap, `0` = N/A (hyperbolic past Pe).
- `o.timeToNextApsis`: seconds. `NaN` for the hyperbolic past-Pe case.

`o.encounterExists !== 0` is the master gate per advisor, the fork doesn't
guard `UTsoi` etc. when no transition is pending, so values there are
stale.

## Files

- `packages/core/src/schemas/telemachus.ts`: six new keys.
- `packages/data/src/schema/telemachusMeta.ts`: six new meta entries.
- `packages/components/src/shared/OrbitalEventChips.tsx`: new shared
  vessel-wide chip row.
- `packages/components/src/TargetPicker/index.tsx`: chip row +
  `dataRequirements` additions.
- `packages/components/src/MapView/index.tsx`: chip in header,
  encounter-point marker on prediction overlay, `dataRequirements`.
- `packages/components/src/SystemView/index.tsx`: encounter / apsis
  props plumbed through to AlmanacPanel; `dataRequirements`.
- `packages/components/src/SystemView/AlmanacPanel.tsx`: four new
  optional props + matching row formatters.

## Validation checklist (next live session)

- Plan a Mun encounter from Kerbin orbit: MapView should show **ENC ·
  Mun · <Δt>** in the header and a blue ring on the ground track where
  the prediction terminates.
- From a Mun orbit, set up an escape: MapView shows **ESCAPE · Kerbin ·
  <Δt>**, amber ring on the ground track. Sanity-check the readout reads
  like "ESCAPE · Kerbin · 2m 14s".
- TargetPicker shows the same chip below the title independent of which
  tab is active; compact (`!showTabs`) branch should NOT render it.
- SystemView: focus the body the vessel is heading for, the encounter
  row appears in AlmanacPanel; focus the vessel's current parent, the
  "Next Pe" / "Next Ap" row appears.
- Test the **open question from the followups doc**: does
  `o.encounterTime` count down sensibly through warps? (Stock KSP keeps
  it relative-to-now even under warp, so it should.)
- ESCAPE label copy: confirm "ESCAPE · Kerbin · 2m 14s" reads cleanly
  in practice; tweak if it scans as "we are escaping Kerbin" rather
  than "we will re-enter Kerbin's SOI".

## What didn't ship

Other items from `local_docs/telemachus_api_followups_2026-05-14.md` are
next on the list: atmospheric cluster, body data (rotation animation /
gradient / description), then the two fork extensions
(`tar.availableVessels`, `flow`/`nominalFlow` on `r.resourceFor`).
