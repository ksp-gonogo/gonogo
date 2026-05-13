# Scene-linked dashboards — tag profiles, prompt on scene transitions

- **Date:** 2026-05-11
- **Commit:** `1dff591`
- **Validation:** ⏳ pending — landed and tested in CI; not yet exercised against a real `kc.scene` stream.

## Why

Mission Profiles let the operator save and recall whole dashboard layouts, but switching between them was a manual step. The natural cue for "swap dashboards now" is KSP's scene change (Editor → Flight at launch, Flight → SpaceCenter at recovery, etc.).

Auto-loading on scene change was rejected as too aggressive — the operator may have intentionally arranged a dashboard for a non-default scene, and a scene transition can fire mid-mission for transient reasons. Instead: **prompt**, never auto-switch, and never switch *away* because of a scene change.

## What

### Persistence schema change

`MissionProfile.sceneBindings?: BindableScene[]` — a new optional field listing which scenes should prompt for this profile.

```ts
export const BINDABLE_SCENES = [
  "SpaceCenter",
  "Editor",
  "Flight",
  "TrackingStation",
] as const;
```

Transient scenes (`MainMenu`, `Loading`, `Unknown`) are deliberately absent. The binding model only ever *switches to* a profile when entering a tagged scene — never *away* because of one — so a transient binding would never resolve.

**Forward-compat:** unknown scene names are dropped quietly on load. A future BINDABLE_SCENES expansion can ship a profile with that scene tagged and older builds will just ignore it.

**Backward-compat:** absent/empty `sceneBindings` = the profile is purely manual. Existing saved profiles continue to work unchanged.

### `MissionProfilesService` additions

- `save(name, items, layouts, sceneBindings?)` — fourth arg, defaults to empty (which normalises to `undefined` for storage tidiness).
- `update(id, patch)` — `patch` now accepts `sceneBindings`. Empty arrays normalise back to `undefined`.
- `findForScene(scene)` — returns the most-recently-updated profile tagged for `scene`, or `undefined`. Collision resolution piggybacks on the existing newest-first `list()` ordering.

Test coverage:
- persist + retrieve via `findForScene`
- empty array → undefined normalisation
- edit + clear sceneBindings via `update`
- collision = most-recently-updated wins
- unknown scene names dropped on load
- all-unknown bindings → `undefined`

### `MissionProfilesModal` UI

- Save row gains a chip-row picker (`@gonogo/ui` `FilterChip`) underneath the name input.
- Each saved profile row gains the same chip row inline — tap a chip to toggle the binding live.

### `SceneSwitchPrompt` component

Watches `kc.scene` via `useGameContext()`. On a real transition (not initial mount), looks up `findForScene(scene)`. If a match: renders a `FabPrompt` next to the dashboard FAB column with `Switch to <Profile Name>?`. Tap → atomic dashboard swap via `onLoad`. Dismiss → fades away. Auto-dismisses after 15s.

Initial-mount transitions are explicitly suppressed (`previousSceneRef.current === null`) so a fresh page-load doesn't always pop a prompt.

### `FabPrompt` primitive (new in `@gonogo/ui`)

Sausage-shaped action prompt sitting bottom-right at a caller-supplied `bottom` offset, designed to align with the existing FAB stack. Primary tap target + small dismiss ×. `role="status"` + `aria-live="polite"` so screen readers pick it up without interrupting urgent alerts. Auto-dismiss timer with `prefers-reduced-motion` honour on the entrance animation.

Why a primitive: there will be more transient FAB-adjacent suggestions in the future (the original recovery-flow "sausage" idea, mode-switch prompts on signal loss, etc.). Putting it in `@gonogo/ui` from the first consumer keeps the bottom-right corner consistent.

## Files

```
packages/ui/src/FabPrompt.tsx                                   (NEW)
packages/ui/src/index.ts                                        (export FabPrompt)
packages/app/src/missionProfiles/SceneSwitchPrompt.tsx          (NEW)
packages/app/src/missionProfiles/MissionProfilesService.ts      (BINDABLE_SCENES + sceneBindings + findForScene)
packages/app/src/missionProfiles/MissionProfilesService.test.ts (7 new tests)
packages/app/src/missionProfiles/MissionProfilesModal.tsx       (chip rows on save + each row)
packages/app/src/missionProfiles/index.ts                       (export SceneSwitchPrompt)
```

## Outstanding

- Live verify: tag a profile for Flight, transition into Flight, confirm the sausage appears next to the FAB. Tap → dashboard swaps atomically. Dismiss → goes away. Auto-dismiss after 15s.
- Confirm the "never switches away" invariant: leave a profile loaded, transition into a scene tagged for a *different* profile, dismiss the prompt. The current profile should stay loaded.
- Reload page mid-Flight with a Flight-tagged profile that isn't currently loaded — confirm no prompt fires (initial-mount suppression).
- Collision behaviour: two profiles both tagged for Flight, edit one to bump its `updatedAt`, transition into Flight — confirm the prompt offers the most-recently-edited.
- Station screen: `MissionProfilesService` is per-screen, so the station has its own profile list. Confirm the SceneSwitchPrompt mounts on both screens and pulls from each screen's own bindings.
