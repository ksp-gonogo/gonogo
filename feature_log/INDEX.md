# Feature log

One entry per substantial piece of work. Used to:

1. Reconstruct what shipped and why, weeks or months after the fact.
2. Track **validation state** — has the work been exercised in a live session,
   not just CI? An unvalidated entry is a candidate suspect for any new bug,
   even if it isn't the work currently in flight.

Entries are checked into git so the log survives a machine swap and is shared
with collaborators. Planning docs stay in `local_docs/` (gitignored) — entries
may link to them but expect those links to dead-end on a fresh checkout.

## When to add an entry

Add an entry when *any* of these is true:

- The work spans more than one commit.
- The work was driven by a planning doc in `local_docs/`.
- The user explicitly asked for a log.
- The change touches a wire format, persistence schema, or other contract that
  could regress silently in someone else's session.

Trivial bugfixes and one-line tweaks don't need an entry.

## Validation states

- **⏳ pending** — landed and tested in CI, but not yet exercised in a real
  KSP / multi-screen session by the user. **Treat as a regression suspect**
  until promoted.
- **✅ confirmed YYYY-MM-DD** — the user has confirmed the feature works as
  intended in a live session.
- **🪦 superseded by `<entry>`** — the work has been replaced or removed by a
  later entry. Keep the link for archaeology; don't delete.

## Regression workflow

When the user reports a bug, **scan this index first** for entries marked
pending. The bug is just as likely to be in unvalidated work as in the work
currently in flight. The 2026-05-08 incident is the canonical example: a bug
that looked like it came from active work was actually a regression in the
piece shipped immediately before.

## Entries (newest first)

- 2026-05-16 — [Ship Map Phase 2 — harness, snapshots, sizing, freeze fix, orientation](2026-05-16-ship-map-phase-2.md) — `14c4756`..`2455c35` (+ fork `c0cc3bd`) — ⏳ pending (SVG-render harness + 5 snapshot tests; useTopology cascade freeze fix with regression coverage; heat-tint overlay replacing the latent parseHex no-op; bounds.size axis convention fix so radial solar panels stop rendering as wings; cargo-bay classification gate; per-part orientation via fork-emitted `up` vector + client-side rotation; nose-cone dome + parachute dome + frustum capsule shapes; needs a live destruction-cascade run, a hot-part observation, and a fixture re-capture against the rebuilt fork DLL to promote)
- 2026-05-14 — [Power Systems — flow / nominalFlow + producers/consumers widget](2026-05-14-power-systems.md) — `db4c29a` — ✅ confirmed 2026-05-15 (Telemachus fork: r.resourceFor[fid] extended with signed flow + nominalFlow; PowerSystems widget aggregates producers vs consumers per resource; engine flow units fix re-verified live across three engine catalog rates — LV-T45 vac, LV-T45 atm, LV-909 — all matching to 2 decimal places; v2 dispatch live-confirmed for ModuleCommand, ModuleReactionWheel, ModuleLight, TelemachusPowerDrain, ModuleAlternator; alternator ghost-EC post-flameout bug found + fixed inline; ISRU + drill still deferred — needs station-class craft)
- 2026-05-14 — [tar.availableVessels — native vessel listing, retires kOS feed](2026-05-14-tar-available-vessels.md) — `be7121a` — ✅ confirmed 2026-05-15 (Telemachus fork: new `tar.availableVessels` handler returning `[{ index, name, type, situation, body, position }]` walking FlightGlobals.Vessels with default Flag/EVA/Debris/Unknown + active-vessel exclusion; client schema + meta; TargetPicker fully rewritten on the native path, kOS dependency dropped; live-verified against a save with 10 asteroids + 3 Testers — array shape, active-vessel exclusion both directions, non-contiguous indices, `tar.setTargetVessel` round-trip, post-swap reappearance all clean)
- 2026-05-14 — [Body data — rotation marker + atmosphere gradient + description](2026-05-14-body-data.md) — uncommitted — ⏳ pending (eight new indexed `b.*` keys; opt-in `rotationAngleDeg` / `atmosphereDepthM` / `atmosphereHasOxygen` props on shared OrbitDiagram with two new contract tests; single-body `useBodyRotation` hook keeps the WS-rate angle off the system-wide fan-out; SystemView AlmanacPanel gains hill-sphere row, "Does not rotate" hint, and body description paragraph; needs a live Mun / Eve / Kerbin orbit pass to promote)
- 2026-05-14 — [Atmospheric cluster — LandingStatus / AtmosphereProfile / ScienceBench / ShipMap](2026-05-14-atmospheric-cluster.md) — uncommitted — ⏳ pending (eight `v.atmospheric* / external* / biome / solar*` keys wired into schema + meta; new Unit literals `kg/m³`, `K`, `W/m²`; LandingStatus ambient section, AtmosphereProfile live chip, ScienceBench live biome in header, ShipMap external-temp background tint; solar keys land in schema but await PowerSystems widget; needs a Kerbin reentry + atmospheric flight to promote)
- 2026-05-14 — [Encounter + next-apsis chips — TargetPicker / MapView / SystemView](2026-05-14-encounter-chips.md) — uncommitted — ⏳ pending (six `o.encounter*` / `o.nextApsis*` keys wired into TargetPicker header chip, MapView header chip + ground-track ring at SOI transition, SystemView AlmanacPanel rows; shared `OrbitalEventChips` component; needs a live Mun-encounter / Mun-escape flight to promote)
- 2026-05-14 — [Ship Map — seq-driven `v.topology` refetch](2026-05-14-ship-map-seq-driven-refetch.md) — `61be606` — ⏳ pending (new `useTopology` hook in @gonogo/data; subscribes to `v.topologySeq` continuously, briefly re-subscribes to `v.topology` only on bump; 2026-05-15 stress test caught **one bug**: hook freezes during rapid destruction cascades — widget locked at seq 119 while real seq advanced to 147 via 30+ onPartDie bumps; hypothesis is the 2s FETCH_TIMEOUT_MS dropping the subscription faster than Telemachus can push back during chaos; Phase 2 fix candidate documented in local_docs/2026-05-16-phase-2-shipmap-handoff.md)
- 2026-05-14 — [Maneuver editing — wire `o.updateManeuverNode`](2026-05-14-maneuver-edit.md) — uncommitted — ⏳ pending (per-node inline editor with UT + radial/normal/prograde inputs; closes the last unused maneuver-write action; from the 2026-05-14 telemetry audit follow-up — rest of the follow-ups parked in `local_docs/telemachus_api_followups_2026-05-14.md`)
- 2026-05-14 — [Ship Map widget — re-wired onto Telemachus v.topology](2026-05-14-ship-map-on-telemachus-topology.md) — `cb5d74c` — ✅ confirmed 2026-05-15 (kOS pipeline dropped; subscribes to `v.topology` + dynamic `r.resourceFor[fid]` / `therm.part[fid]` via new `usePartsLive`; prefab bounds replace the mass-cubed-root sizing heuristic; widget rendered correctly against live Validator-1 craft; axis-rotation bug found and fixed inline — `pickLateralAxis` now uses X/Z spread, `buildShipMapPart` reads `axial: orgPos[1]` per KSP's Y-up local-frame convention)
- 2026-05-13 — [Launch Director in-flight panel](2026-05-13-launch-director-in-flight.md) — uncommitted — ⏳ pending (in-flight mode triggers on kc.scene=Flight; mission time + altitude readouts; Recover / Revert-to-launch / Revert-to-VAB greyed by `ksp.canRevert*`; crash chip + disabled recover when crash.hasRecent; covers feedback #11)
- 2026-05-13 — [Strategies / Admin Building widget](2026-05-13-strategies-widget.md) — uncommitted — ⏳ pending (consumes the strategies.* fork keys shipped 2026-05-13; active / available / locked sections; commitment-factor slider with effective-cost preview; two-step arm-then-confirm; covers feedback #25)
- 2026-05-13 — [Contract-parameter fire collapse](2026-05-13-contract-parameter-fire-collapse.md) — uncommitted — ⏳ pending (multiple fired contract-parameter alarms collapse into one banner row with Ack-all; main row preserved for threshold/time fires; covers feedback #6)
- 2026-05-13 — [2026-05-12 feedback — autonomous batch](2026-05-13-feedback-session-batch.md) — `d886c7c`..`a81207c` — ⏳ pending (24 of 30 feedback items landed; banner overhaul, notes intellisense, requires placeholder, alarm-bell state, picker redesign, copy rename; live multi-screen session needed to promote; 6 items deferred with scoping docs in local_docs/2026-05-12-feedback/)
- 2026-05-12 — [Bug report form in Diagnostics & Logs](2026-05-12-bug-report-form.md) — uncommitted — ⏳ pending (form lands `tag == "bug-report"` Axiom entries with description + recent-logs slice + optional resized screenshot; needs one live submission against a real `VITE_AXIOM_TOKEN` build to confirm the entry shape lands as designed)
- 2026-05-12 — [Banner primitives extraction — SourceOfflineBanner pinned, BannerPill shared](2026-05-12-banner-primitives-extraction.md) — `f803be6` — ⏳ pending (retro entry; @gonogo/ui surface refactor + bottom-anchor fix for SourceOffline; 2026-05-12 feedback: full banner overhaul incoming — bottom-right anchored to replace top BannerPill placement entirely)
- 2026-05-11 — [Flight outcome banner — unify recovery + crash](2026-05-11-flight-outcome-banner.md) — `9a67ab3` — ⏳ pending (FlightOutcomeBanner replaces RecoverySummaryBanner, handles both green-recovered + red-destroyed paths; 2026-05-12 feedback: recovery banner reached user but crash banner did NOT — needed refresh to see "vessel destroyed"; revert-from-crash leaves stale dead crew until refresh; recovery gains section needs tabulation)
- 2026-05-11 — [Scene-linked dashboards — tag profiles, prompt on scene transitions](2026-05-11-scene-linked-dashboards.md) — `1dff591` — ⏳ pending (retro entry; sceneBindings persistence schema addition, new FabPrompt primitive)
- 2026-05-11 — [Telemachus CORS allowlist + README](2026-05-11-telemachus-cors-allowlist.md) — `3421f68` — ✅ confirmed 2026-05-11 (boot log shows ALLOWED_ORIGINS loaded; cross-origin curl from allowlisted origin returns Access-Control-Allow-Origin echo + Vary: Origin; non-allowlisted origin omits the header)
- 2026-05-11 — [Telemachus fork → upstream PR prep](2026-05-11-telemachus-upstream-prep.md) — uncommitted — ⏳ in progress (cherry-picking the fork patches into independently-appliable upstream PRs)
- 2026-05-11 — [Overnight Telemachus consumer sweep + crash handler](2026-05-11-overnight-telemachus-consumers.md) — uncommitted — ⏳ pending (CrashDataHandler new in fork; StaffRoster expansion + AlarmsModal AG captions in gonogo; alarm-mirror deferred on CORS/WS-observation design; 2026-05-12 feedback: crash didn't propagate to dashboard until refresh — confirm fork DLL is live and CrashDataHandler events are firing; StaffRoster expansion shipped but badges need per-label tooltips + tiny mode; AltitudeProgress dynamic styled.span hits >200 class warning)
- 2026-05-10 — [Peer graceful rotation + pre-emptive suspend cleanup](2026-05-10-peer-graceful-rotation.md) — `7cacbb2` — ⏳ pending (needs live laptop-sleep cycle with ≥1 station connected to fully validate)
- 2026-05-10 — [Telemachus extension — housekeeping + fork migration](2026-05-10-housekeeping-and-fork-migration.md) — uncommitted — ⏳ pending (housekeeping fixes ✅ on the live-validated phases; fork migration compiled + installed but next-boot pending)
- 2026-05-09 — [Telemachus extension — Phase 4 slice 2](2026-05-09-telemachus-extension-phase-4-slice-2.md) — `e992bd8` (+ `9b8a858` live-fixes) — ✅ confirmed 2026-05-10 (kc.savedShips part-walk + kc.crewRoster + kc.upgradeFacility validated; ksp.launch fires but needs the active-vessel safety check from the housekeeping pass to be reliable)
- 2026-05-09 — [Telemachus extension — Phase 4 slice 1](2026-05-09-telemachus-extension-phase-4-slice-1.md) — `2fcffcd` (+ `9b8a858` live-fixes) — ✅ confirmed 2026-05-10 (tech.unlock, contracts.accept/decline/cancel, sci.deploy all validated end-to-end with state changes)
- 2026-05-09 — [Telemachus extension — Phase 3](2026-05-09-telemachus-extension-phase-3.md) — `127ddf4` — ✅ confirmed 2026-05-10 (contracts.active/offered/completedRecent return correct shapes; KSP-generated replacement contracts after decline observed working)
- 2026-05-09 — [Telemachus extension — Phase 2](2026-05-09-telemachus-extension-phase-2.md) — `2394cc6` (`160a452` migration-prereq follow-up) — ✅ confirmed 2026-05-10 (sci.instruments / experimentBreakdown / canTransmitTotal all validated; ParseSubjectId heuristic correctly split "crewReport@KerbinSrfLandedLaunchPad")
- 2026-05-09 — [Telemachus extension — Phase 1](2026-05-09-telemachus-extension-phase-1.md) — `7515638` (+ `0d14cdc` API fixes + `9b8a858` lifecycle fixes) — ✅ confirmed 2026-05-10 (all kc.* + tech.* read keys live-validated; PluginRegistration / KSPAssembly / KSPAPIBase fork patches needed before in-game register worked)
- 2026-05-09 — [Space Center Status — facility upgrades](2026-05-09-space-center-facility-upgrades.md) — `1cae0a7` — ⏳ pending (retro entry; plugin SetCurrentLevel+AddFunds pipeline is the riskiest piece, no live SC upgrade run yet; 2026-05-12 feedback: VAB shows 1/1 or 0/1 instead of three tiers — likely fork-migration regression; widget also needs tiny mode + funds display + clarify parts section)
- 2026-05-09 — [Mission Director cancel + contract-parameter alarms + scene banner](2026-05-09-mission-director-cancel-and-parameter-alarms.md) — `5ca10d8` — ⏳ pending (retro entry; new contract-parameter AlarmTrigger kind, narrowing fix landed later in `09a9007`; 2026-05-12 feedback: cancel button much smaller than confirm-forfeiture; parameter bells don't reflect alarm-set state and have inconsistent feedback; alarms pollute top alarm banner heavily; SceneChangeBanner doesn't propagate consistently to stations)
- 2026-05-09 — [Dim-overlay sweep](2026-05-09-dim-overlay-sweep.md) — `c3ac509` (+ `73c42dd` partial-dim follow-up + `91d94f6` StaffRoster) — ⏳ pending (visible-in-screenshot dimming working as designed; needs full widget walkthrough to fully promote)
- 2026-05-09 — [Action-group alarm UI](2026-05-09-action-group-alarm-ui.md) — `6c81cd6` — ⏳ pending (2026-05-12 feedback: AG-alarm setting "worked beautifully" — positive; but bell icon shouldn't appear in tiny mode (style breakage); also need to surface Telemachus status codes 0-5 when AGs are unsupported, currently silent failure)
