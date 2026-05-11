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

- 2026-05-11 — [Telemachus CORS allowlist + README](2026-05-11-telemachus-cors-allowlist.md) — uncommitted — ⏳ pending (config-driven echo-origin CORS in the fork; unlocks reading action responses cross-origin. Required for the deferred alarm-mirror feature; itself unverified live)
- 2026-05-11 — [Overnight Telemachus consumer sweep + crash handler](2026-05-11-overnight-telemachus-consumers.md) — uncommitted — ⏳ pending (CrashDataHandler new in fork; StaffRoster expansion + AlarmsModal AG captions in gonogo; alarm-mirror deferred on CORS/WS-observation design)
- 2026-05-10 — [Telemachus extension — housekeeping + fork migration](2026-05-10-housekeeping-and-fork-migration.md) — uncommitted — ⏳ pending (housekeeping fixes ✅ on the live-validated phases; fork migration compiled + installed but next-boot pending)
- 2026-05-09 — [Telemachus extension — Phase 4 slice 2](2026-05-09-telemachus-extension-phase-4-slice-2.md) — `e992bd8` (+ `9b8a858` live-fixes) — ✅ confirmed 2026-05-10 (kc.savedShips part-walk + kc.crewRoster + kc.upgradeFacility validated; ksp.launch fires but needs the active-vessel safety check from the housekeeping pass to be reliable)
- 2026-05-09 — [Telemachus extension — Phase 4 slice 1](2026-05-09-telemachus-extension-phase-4-slice-1.md) — `2fcffcd` (+ `9b8a858` live-fixes) — ✅ confirmed 2026-05-10 (tech.unlock, contracts.accept/decline/cancel, sci.deploy all validated end-to-end with state changes)
- 2026-05-09 — [Telemachus extension — Phase 3](2026-05-09-telemachus-extension-phase-3.md) — `127ddf4` — ✅ confirmed 2026-05-10 (contracts.active/offered/completedRecent return correct shapes; KSP-generated replacement contracts after decline observed working)
- 2026-05-09 — [Telemachus extension — Phase 2](2026-05-09-telemachus-extension-phase-2.md) — `2394cc6` (`160a452` migration-prereq follow-up) — ✅ confirmed 2026-05-10 (sci.instruments / experimentBreakdown / canTransmitTotal all validated; ParseSubjectId heuristic correctly split "crewReport@KerbinSrfLandedLaunchPad")
- 2026-05-09 — [Telemachus extension — Phase 1](2026-05-09-telemachus-extension-phase-1.md) — `7515638` (+ `0d14cdc` API fixes + `9b8a858` lifecycle fixes) — ✅ confirmed 2026-05-10 (all kc.* + tech.* read keys live-validated; PluginRegistration / KSPAssembly / KSPAPIBase fork patches needed before in-game register worked)
- 2026-05-09 — [Dim-overlay sweep](2026-05-09-dim-overlay-sweep.md) — `c3ac509` (+ `73c42dd` partial-dim follow-up + `91d94f6` StaffRoster) — ⏳ pending (visible-in-screenshot dimming working as designed; needs full widget walkthrough to fully promote)
- 2026-05-09 — [Action-group alarm UI](2026-05-09-action-group-alarm-ui.md) — `6c81cd6` — ⏳ pending
