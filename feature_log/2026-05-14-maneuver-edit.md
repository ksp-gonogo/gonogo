# Maneuver editing — wire `o.updateManeuverNode`

**Date:** 2026-05-14
**Validation:** ⏳ pending — landed and tested in CI (343 component tests
green, full lint clean). Not yet exercised in a live KSP session.

## What changed

Per-node inline editor in `ManeuverPlanner`. Each planned-node row gets a
pencil-icon button next to the existing delete-X. Click it → the row
expands to four numeric inputs (UT, Prograde, Normal, Radial), plus
Save / Cancel. Save fires
`o.updateManeuverNode[id, ut, radial, normal, prograde]` — same
`[radial, normal, prograde]` vector convention as `o.addManeuverNode`.

This closes the last unused maneuver-write action in the Telemachus fork.
Add and remove were already wired (the 2026-05-14 audit confirmed both);
update was the only one missing.

## Wire shape (recap)

Server signature (fork `VesselDataHandlers.cs:1046`):

```
o.updateManeuverNode[id, ut, x, y, z]
```

Args land in `node.OnGizmoUpdated(new Vector3d(x, y, z), ut)`. KSP's
node-local frame is `Vector3d(radialOut, normal, prograde)`, so x = radial,
y = normal, z = prograde. Mixing the order turns a pure-prograde burn into
a pure-radial burn — the same gotcha as `o.addManeuverNode` (already in
the memory).

## Files

- `packages/ui/src/Icons.tsx` — added `PencilIcon` (lucide `Pencil`).
- `packages/components/src/ManeuverPlanner/NodeRow.tsx` — added edit-mode
  state, `NodeEditPatch` interface, `NodeEditor` sub-component (four
  `LabeledInput`s + Save/Cancel). Phantom (completed) rows skip the
  edit affordance.
- `packages/components/src/ManeuverPlanner/ManeuverNodeList.tsx` — passes
  `onEdit` through.
- `packages/components/src/ManeuverPlanner/index.tsx` — `handleEdit(id,
  patch)` calls `execute('o.updateManeuverNode[...]')`.
- `packages/components/src/ManeuverPlanner/index.test.tsx` — new
  integration test: open editor, change prograde, Save → asserts the
  full action string and the `[id, ut, radial, normal, prograde]` arg
  order.

## What didn't ship

This is part of the 2026-05-14 telemetry audit follow-up. The remaining
items live in `local_docs/telemachus_api_followups_2026-05-14.md` — most
need either widget surgery on multiple components (atmospheric cluster,
body data, encounters) or new fork extensions (`tar.availableVessels`,
`flow` on `r.resourceFor`).

## Validation checklist (for the next live session)

- Open the planner in flight; plan a small prograde burn; click pencil;
  change prograde from e.g. 30 → 45; Save; confirm the KSP node updates
  in the map view to match.
- Cancel preserves prior state (no action fires).
- The Save button stays disabled until at least one field changes.
- Editing a node that's been removed in-game between open and save
  should fail gracefully (the action returns null upstream, no client
  crash). Verify by deleting from the KSP map after opening the editor.
