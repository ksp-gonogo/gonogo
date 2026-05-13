# 2026-05-12 feedback — autonomous batch

- **Date:** 2026-05-13
- **Commits (gonogo):** `d886c7c`, `0a3337d`, `11286a8`, `3b534fc`, `d5fae7d`, `a81207c`, `26aab21`, `2bdb17b`, `3c92659`, `6b2fa40`
- **Commits (Telemachus fork):** `ebb43ad` on `telemachus/career-mode` (PR #86) — needs `git push fork telemachus/career-mode` to update the PR
- **Validation:** ⏳ pending — 396 app + 329 components + 115 ui + serial/replay/proxy/data suites all green, lint clean. Live curl probes confirmed `tech.nodes`, `kc.facilityLevels` (incl. `currentLevelText`/`nextLevelText`), `crash.lastCrash`, and the FlightOutcomeBanner reproduction. Still need a full multi-screen KSP session to walk every banner / widget / new feature for the promotion check.
- **Feedback source:** `local_docs/2026-05-12-feedback/feedback.md` + attachments.

## What landed

24 of the 30 feedback items are coded; 6 are pending and scoped (links
below). Tasks tracked in TaskList during the session — the table here
mirrors that.

### Mechanical polish

- `#10` Notes — tick (mark-done) button alongside delete, 10px row gap.
- `#13` Launch Director — tapping the selected vessel clears selection.
- `#16` FlightOutcomeBanner — gains tabulated as a 3-column grid.
- `#17` StaffRoster — per-badge tooltips for L0 / BA / 1F / ★ / missing.
- `#18` StaffRoster — tiny mode (compressed N/total available + missing).
- `#22` ActionGroup — bell hidden in tiny mode (style breakage cause).
- `#30` MissionDirector — `AltitudeBarFill` width via `.attrs({ style })`
  to stop the >200-class warning.

### Targeted fixes

- `#4` MissionDirector — Cancel + Confirm-forfeit buttons now match
  size (10px / 2px8px) instead of confirm dwarfing the arm.
- `#5` MissionDirector — parameter bells reflect alarm-set state; click
  on a set bell toggles it off. Uses new `AlarmManagerLookup` contract
  on `AlarmsLauncherProvider`.
- `#7` Notes — host pushes a fresh snapshot to every newly-connected
  peer (was only broadcasting on mutation, so stations joining late
  saw an empty list).
- `#9` Notes — distinguish "unknown key" (`[?<key>]`) from "value
  pending" (`…`) from "null/NaN" (`—`). Uses `data.schema()` to
  identify typos.
- `#21` ActionGroup — surface "Paused" / "No signal" reason chip when
  `t.isPaused` / `comm.connected` indicate the AG can't fire.
- `#28` SceneChangeBanner — persist last-seen scene in localStorage so
  stations that reload mid-session can still recognise a transition.

### Architectural

- `#1` (and `#6` resolved-by-`#1`) — Banner overhaul: new
  `<BannerStack>` primitive in `@gonogo/ui` parks all status banners
  (signal loss, version mismatch, warp/alarms, flight outcome, scene
  change, sustained-failure) in a fixed bottom-right column just left
  of the FAB. Slide-in entry animation respecting `prefers-reduced-motion`.
  `AlarmBanner` early-returns null when warp is 1× and no alarm is
  pending — fixes the "alarms pollute the top banner" feedback.
  `ReplayBanner` stays a top sticky bar (interactive timeline controls,
  not a status pill).
- `#19` RequiresGuard — render a compact placeholder instead of
  dimming full default-size widget content when a requirement isn't
  met. First-load dashboards no longer show a forest of tall
  empty-but-dimmed cards.
- `#14` CLAUDE.md — new "Spending funds — always show the balance"
  rule. Widgets touched in this batch (LaunchDirector,
  SpaceCenterStatus) now surface `career.funds` in their subtitle.

### Copy / rename

- `#15` — widget renames + description rewrites:
  - Launch Director → "Launch & Recovery"
  - Mission Director → "Contracts Board"
  - Science Officer → "Science Lab"
  - Descriptions dropped technical jargon ("write actions",
    "development phases", Phase-N references).

### Smaller new features

- `#12` LaunchDirector — launch button shows a spinner + "Launching…"
  state until the scene flips to Flight (10s safety timeout). Stops
  double-click double-firing `ksp.launch`.
- `#20` SpaceCenterStatus — tiny mode (funds + pad badge), funds in
  the subtitle, "Parts unlocked" label with tooltip clarifying the
  R&D-tier meaning.
- `#23` Science Lab — total stored data in subtitle; Deploy / Confirm
  Transmit buttons render `Spinner` + pending label until the next
  `sci.instruments` state lands.
- `#27` Widget picker (ComponentOverlay) — Spotlight-style fixed
  panel height, singleton tags dropped, "N of M" results header.
- `#8` Notes — new `<TagAutocomplete>` inline-popover that opens on
  `{{`. Merges live schema with `telemachusMeta` friendly labels.

### Live-KSP verified + landed (later additions)

- `#2` FlightOutcomeBanner crash propagation — live curl on
  `crash.lastCrash` confirmed the fork emits the snapshot correctly;
  bug was widget-side (Effect 1 baseline preempting Effect 2 on
  flight-end). Fix at `3c92659`; regression test
  `flight-outcome-banner.test.tsx` covers it.
- `#3` VAB upgrade tiers — live curl confirmed the fork's `max` field
  is the *upgrade-count* (KSP's `GetFacilityLevelCount`), not
  tier-count. Widget now renders 1-indexed `{level+1}/{max+1}`; VAB
  at full tier 3 shows "3/3 MAX" instead of "1/1". Fix at `3c92659`.
- `#24` Tech Tree widget — built on top of the new `tech.nodes` fork
  data (commit `ebb43ad` on `telemachus/career-mode`). Filterable
  list (Researchable / All / Unlocked), free-text search, click-to-
  expand reveals description + parent chips + full parts list with
  manufacturer / category / entryCost / purchased per part.
  Arm-then-confirm Unlock fires `tech.unlock[<id>]`, gated by science
  + scene + pending-resolution. Tiny mode shows the researchable
  count. Commit `6b2fa40`. Same commit also surfaces the new
  `currentLevelText` / `nextLevelText` fields from `kc.facilityLevels`
  in `SpaceCenterStatus` — multi-line tooltip on every facility cell
  (compact mode) plus an inline "Now / Next" block in normal mode.

### Telemachus fork additions (commit `ebb43ad`)

Lives on `telemachus/career-mode`, ready to push as a PR #86 update.

- `tech.nodes` — new TelemetryAPI emitting the full RDNode graph from
  `AssetBase.RnDTechTree.GetTreeNodes()`. Per node: `id`, `title` (via
  `ResearchAndDevelopment.GetTechnologyTitle`), `description` (parsed
  out of `tree.GetTreeConfigNode()`'s RDNode entries and routed
  through `Localizer.Format`), `scienceCost`, `state`, `parents` (read
  from `ProtoRDNode.parents` directly — elements are themselves
  ProtoRDNodes), and `parts` (every `AvailablePart` whose
  `TechRequired` matches, with `name`/`title`/`manufacturer`/`category`
  /`entryCost`/`purchased`). Two session-stable caches:
  `_descriptionsByTech` and `_partsByTech`, built once on the first
  call and reused for the lifetime of the KSP process. Result list
  itself sticky-cached during `IsTransientLoadingState()` the same
  way `tech.unlockedIds` / `tech.affordable` already are.
- `kc.facilityLevels` — extended payload with `currentLevelText` +
  `nextLevelText` (multi-line bullet-list text matching what KSP's
  stock upgrade dialog renders). Pulls from
  `UpgradeableFacility.GetLevelText(int)` via the existing
  `protoUpgradeables` access path; empty strings when refs unavailable
  (e.g. before SC scene loaded). Existing
  `level`/`max`/`upgradeFunds` fields unchanged.

Both keys are `AlwaysEvaluable=true` so they read fine from any scene.
Builds clean under dotnet 10 against the bundled Assembly-CSharp.

## Deferred (scoping docs only)

- `#11` Launch Director in-flight rework —
  `local_docs/2026-05-12-feedback/scoping-launch-director-inflight.md`
- `#24` Tech Tree widget —
  `local_docs/2026-05-12-feedback/scoping-tech-tree-widget.md`
- `#25` Strategies widget —
  `local_docs/2026-05-12-feedback/scoping-strategies-widget.md`
- `#26` Parts breakdown widget —
  `local_docs/2026-05-12-feedback/scoping-parts-breakdown.md`
- `#29` Warp pause/play — needs fork-side `f.pause` action; see
  `local_docs/2026-05-12-feedback/live-checks-needed.md`.
- `#2` Crash propagation — strong regression suspect against
  `2026-05-11-overnight-telemachus-consumers.md`. Likely the .dll
  isn't booted; needs a live KSP curl to confirm.
- `#3` VAB upgrade tiers — fork-side math suspect; needs a live
  `kc.facilityLevels` curl. See `live-checks-needed.md`.

## Files

```
CLAUDE.md                                              (rule addition)
feature_log/INDEX.md                                   (regression flags + this entry)
local_docs/2026-05-12-feedback/                        (live checks + 4 scoping docs)

packages/ui/src/BannerStack.tsx                        (NEW)
packages/ui/src/BannerPill.tsx                         (inline anchor mode)
packages/ui/src/SignalLossBanner.tsx                   (inline)
packages/ui/src/VersionMismatchBanner.tsx              (inline)
packages/ui/src/SourceOfflineBanner.tsx                (inline)
packages/ui/src/index.ts                               (export BannerStack)

packages/app/src/screens/MainScreen.tsx                (BannerStack mount)
packages/app/src/screens/StationScreen.tsx             (BannerStack mount)
packages/app/src/alarms/AlarmBanner.tsx                (inline + quiet-state null)
packages/app/src/alarms/StationAlarmBanner.tsx         (inline)
packages/app/src/alarms/AlarmsLauncherBridge.tsx       (AlarmManagerLookup)
packages/app/src/components/FlightOutcomeBanner.tsx    (inline + gains table)
packages/app/src/components/SceneChangeBanner.tsx      (inline + localStorage)
packages/app/src/components/ComponentOverlay.tsx       (Spotlight layout)
packages/app/src/notes/NotesComponent.tsx              (tick + autocomplete)
packages/app/src/notes/TagAutocomplete.tsx             (NEW — intellisense)
packages/app/src/notes/createNotesHost.ts              (peer-connect snapshot)
packages/app/src/notes/templating.ts                   ([?<key>] / … / —)

packages/components/src/shared/AlarmsLauncher.tsx      (AlarmManagerLookup)
packages/components/src/shared/RequiresGuard.tsx       (compact placeholder)
packages/components/src/ActionGroup/index.tsx          (tiny bell + reason)
packages/components/src/LaunchDirector/index.tsx       (rename + funds + spinner + toggle)
packages/components/src/MissionDirector/index.tsx      (rename + bell state + button size)
packages/components/src/ScienceOfficer/index.tsx       (rename + progress + mits)
packages/components/src/SpaceCenterStatus/index.tsx    (tiny + funds + parts label)
packages/components/src/StaffRoster/index.tsx          (tooltips + tiny mode)

scripts/decode-bug-report.mjs                          (biome reformat only)
```

## Validation needs

Live multi-screen session covering:

1. Banner stack — kill a data source, verify SOURCE OFFLINE pill
   slides in from the right. Launch + recover, verify outcome banner
   stacks above the warp pill. Connect a station mid-flight; confirm
   the same banners appear on the station independently.
2. Notes intellisense — type `{{alt` and verify Altitude / Apoapsis /
   etc. surface. Insert one and confirm the rendered note resolves
   the live value.
3. Notes initial-sync — connect a station to a host that already has
   notes. Should see the list immediately rather than after the
   first mutation.
4. RequiresGuard layout — refresh the dashboard at Space Center scene
   without an active flight. Widgets with `requires: ["flight"]`
   should show a compact "Vessel in flight required" pill, not a
   tall empty card.
5. MissionDirector bells — set an alarm on a contract parameter,
   confirm bell turns accent-coloured; click again, confirm it
   clears.
6. SpaceCenter widget — resize to 2x2, confirm tiny mode shows
   funds + pad badge.
7. Action group — pause KSP, confirm AG widgets show a "PAUSED"
   reason chip. Disconnect comms, confirm "NO SIGNAL".

## Open follow-ups

- Banner entry animation is currently slide-in + scaleX squish — user
  asked for "neat eye-catching". This is v1; a more flourish-y
  animation (accent flash, brief glow) is a polish pass once v1
  lands on screen.
- Mission Director alarm "pollution" was tracked separately as `#6`
  and resolved-by-banner-overhaul. If the user feels the per-parameter
  alarms are still too many *as count*, a follow-up to aggregate
  per-contract objectives would be the next move (not built here).
