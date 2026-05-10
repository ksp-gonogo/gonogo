# Overnight Telemachus consumer sweep + crash handler

- **Date:** 2026-05-11
- **Validation:** ⏳ pending — landed and tested in CI; not yet exercised in
  a live multi-screen KSP session.
- **Context:** Following the 2026-05-10 Telemachus extension work (recovery
  dialog, alarm fixes, action-gate, long-id strings, type-aware parameter
  emit, all bundled in Telemachus.dll 1067520 bytes installed at 23:36),
  this session wires the new server-side data into gonogo widgets and adds
  one new fork handler (`crash.lastCrash`).

## Telemachus fork addition

### CrashDataHandler.cs (new)

Mirror of `RecoveryDialogHandler` but for the destruction case.
Subscribes via a deferred `[KSPAddon(KSPAddon.Startup.MainMenu, true)]`
MonoBehaviour using **instance-method handlers** — same workaround for
KSP's `EventData.EvtDelegate` constructor that does
`evt.Target.GetType().Name` unconditionally and NREs on static-method
delegates.

Subscribes to three 1-param `EventData<EventReport>` events:
- `onCrash` — primary crash trigger
- `onCrashSplashdown` — high-speed water entry
- `onCrewKilled` — appends kerbal name to the active snapshot

KSP fires `onCrash` once per part during a destruction event.
Coalescing window (5s, same vessel id) collects multiple part-loss
events into one snapshot rather than letting later parts overwrite the
first one. After 5s the next crash starts a fresh snapshot.

Exposes two keys:
- `recovery.hasRecent` → `crash.hasRecent` (bool)
- `crash.lastCrash` — full snapshot: vesselName, vesselId, body, situation,
  lat/lon/alt, ut, what (what was hit), msg, eventKind
  (Crash/CrashSplashdown), partsLost (list), crewAboard, kerbalsKilled.

Built into Telemachus.dll 1076736 bytes installed 2026-05-11 00:30. **Requires
KSP restart to load** — the addon registers via the KSPAddon attribute at
MainMenu.

## gonogo-side consumer changes

### StaffRoster expansion

Extended `StaffMember` parser to capture the new `kc.crewRoster` fields:
`veteran`, `isBadass`, `careerFlights`, `courage`, `stupidity`,
`currentVesselName`. Defaults to safe zero/false values so the widget
keeps working against the older Telemachus DLL (before the kc.crewRoster
expansion).

Row chrome additions (using `@gonogo/ui` `Badge` primitive, not
co-located styled spans — per the project's UI-primitive convention):
- Veteran: ★ in `tone="go"`
- Badass: BA in `tone="warn"`
- Career flights count: `{N}F` in `tone="neutral"`
- Unavailable reason (was an ad-hoc styled span): now `tone="nogo"`

Tooltip on each row stitches courage / stupidity / careerFlights /
veteran / badass / currentVesselName into a one-line summary — kept
out of the primary chrome to keep rows compact in narrow layouts.

Tests: 9 pass (added 2 new — "parses expanded fields when present"
and "defaults expanded fields when older Telemachus DLL is loaded").

### AlarmsModal — AG-binding captions

Wired `f.ag.bindings` into the action-group picker via `useDataValue`.
Each option in the "When fires" picker now shows what's bound to that
AG on the active vessel:

```
AG1 (f.ag1) — Toggle Lights
AG2 (f.ag2) — Extend Solar Panels +2 more
```

Caption shows the first bound action's `actionGuiName`, plus a
`+N more` suffix when multiple parts/actions share the AG. Empty
caption when nothing's bound or no active vessel.

Translation helper `kspActionGroupName(toggle)` maps gonogo's toggle
keys (`f.ag1`, `f.brake`, `f.rcs`) to KSP's KSPActionGroup enum names
(`Custom01`, `Brakes`, `RCS`). Cached to a `switch` rather than a
lookup table because the enum name format isn't 1:1 with the toggle
key (e.g. brake → Brakes).

Defensive: `isAgBindingArray` type-guards the unknown payload so a
DLL drift can't crash the picker.

Tests: 45 pass (existing — no new tests added; the change is purely
visual caption text driven by useDataValue, which the existing test
harness already exercises through `useDataSchema`).

### MissionDirector multi-param rendering

Parser updated to capture the type-aware fields (`parameterType`,
`minAltitude`, `maxAltitude`, `body`, `situation`, `partName`). New
`AltitudeProgress` sub-component renders a thin progress bar under any
`Incomplete` parameter of type `ReachAltitudeEnvelope` — fills toward
target band when below, full green when in-band, full grey + `+Xkm`
overshoot when above. Driven by `v.altitude` from the existing live
subscription.

**Long-id-as-string fix shipped in this session also required parser
changes here** — KSP contract IDs exceed 2^53 and the previous strict
`typeof e.id === "number"` would silently drop string-encoded contracts
after the fork's restart. Parser now accepts both string and number,
normalises to string internally. ContractEntry.id is now `string`.

Downstream consumers (`CancelButton`, `DeclineButton`) widened their
contractId prop from `number` to `string`. The contract-parameter alarm
trigger still uses `contractId: number` (alarm-system type) — bell button
is now gated by a safe-integer check via `contractIdToSafeNumber()`;
big-id contracts render a disabled bell with explanatory tooltip rather
than silently dropping the bell or crashing on overflow.

Tests: 16 pass (added 1 new — "preserves big-number contract IDs from
the new long-as-string fork").

### Mission summary banner + modal

New `RecoverySummaryBanner` component (in
`packages/app/src/components/RecoverySummaryBanner.tsx`). Mirrors the
`SceneChangeBanner` pattern: subscribes to `recovery.hasRecent` +
`recovery.lastSummary`, fires the banner on the false→true transition
keyed by `capturedAtUT` (so a sticky snapshot doesn't re-fire). Banner
shows vessel name + funds/sci/rep totals; tap opens a `useModal()`
modal with the full breakdowns (science subjects, parts, resources,
crew XP).

Wired into both `MainScreen` and `StationScreen` next to existing
banners — every screen pops its own independent banner since the
underlying data flows over `PeerBroadcastingDataSource` to every
station automatically.

### Flight history annotation (recovery + crash)

New `FlightOutcome` discriminated union on `FlightRecord` with two
variants: `FlightRecoveryOutcome` (kind: "recovered" — recoveryLocation,
recoveryFactor, fundsEarned, scienceEarned, reputationEarned, crew) and
`FlightCrashOutcome` (kind: "crashed" — body, situation, what,
partsLostCount, kerbalsKilled).

`BufferedDataSource.handleSample` now intercepts `recovery.lastSummary`
and `crash.lastCrash` arrivals, matches the payload to a `FlightRecord`
by vessel name (most-recent-launchedAt wins on name collision), and
persists the outcome via `store.upsertFlight`. Idempotent per
snapshot's `capturedAtUT` / `ut` so sticky telemetry doesn't repeatedly
overwrite the same outcome every WS tick.

`FlightsManager` row renders an `OutcomeBadge` next to the vessel name:
green "recovered" / red "crashed", with a hover tooltip showing the
relevant detail (recovery location/factor/funds, or crash body/parts/
kerbals KIA).

Tests: 272 data tests + 382 app tests still pass; no new tests for the
outcome annotation itself (would need integration-level fixtures with
a fake store + faked recovery.lastSummary samples — worth a follow-up).

## Deferred this session

### Stock alarm mirror — blocked on read-response design

`alarm.add` now returns the new alarm's uint id over HTTP, but
gonogo's data source uses `fetch(url, { mode: "no-cors" })` for
`execute()`, which makes the response body unreadable from the
browser. To mirror a local `TimeTrigger` alarm into stock KSP and
later delete it, gonogo needs the returned id.

Two paths, both larger than overnight-scope:

1. **CORS-enabled execute path**: extend the data source interface
   with `executeAndRead(action): Promise<unknown>`, parse the JSON
   response. Requires Telemachus to set `Access-Control-Allow-Origin`
   on the response — fork edit. Cleanest API, biggest blast radius.
2. **WS observation matching**: gonogo calls `execute("alarm.add[gonogo:<localId>,...]")`
   fire-and-forget, then watches `alarm.list` over the WS subscription
   for a row with matching title prefix to extract the stock id.
   No data layer change, but adds two-step async coupling between
   create and id-capture.

Reconciliation on host startup (delete orphaned `gonogo:` alarms
from a previous session that's no longer running) is mechanically
fine with either path.

**Recommendation:** path 2 (WS observation) — keeps the data layer
contract simple and the alarm mirror's "create + observe" model
matches how gonogo already syncs state with KSP. Worth a focused
design session.

### Stock alarm mirror — same blocker (CORS / WS-observation design)

## Files touched

```
# Fork
local_docs/telemachus-fork/Telemachus/src/CrashDataHandler.cs   (NEW)
local_docs/telemachus-fork/Telemachus/src/KSPAPIBase.cs         (wired handler)

# gonogo (commit 1: 7bc8f1c)
packages/components/src/StaffRoster/index.tsx                    (expanded; uses @gonogo/ui Badge)
packages/components/src/StaffRoster/index.test.tsx               (2 new tests)
packages/app/src/alarms/AlarmsModal.tsx                          (AG captions)

# gonogo (commit 2)
packages/components/src/MissionDirector/index.tsx                (multi-param + altitude progress + id-as-string)
packages/components/src/MissionDirector/index.test.tsx           (1 new test for big-id roundtrip)
packages/app/src/components/RecoverySummaryBanner.tsx            (NEW — banner + modal)
packages/app/src/screens/MainScreen.tsx                          (mount banner)
packages/app/src/screens/StationScreen.tsx                       (mount banner)
packages/data/src/types.ts                                       (FlightOutcome union on FlightRecord)
packages/data/src/BufferedDataSource.ts                          (outcome annotation on recovery/crash samples)
packages/data/src/FlightsManager/index.tsx                       (OutcomeBadge in row)
feature_log/2026-05-11-overnight-telemachus-consumers.md         (this entry)
feature_log/INDEX.md                                             (index update)
```

## Outstanding (small)

- KSP restart needed to load the new DLL (CrashDataHandler + everything
  from the 2026-05-10 batch that the user hadn't booted yet).
- Verify AG captions render correctly with a vessel that has bindings
  configured (next session, in Flight scene).
- Live regression: confirm StaffRoster renders cleanly on both main +
  station, no layout breakage from the new badge density.
