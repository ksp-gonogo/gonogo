# Flight outcome banner — unify recovery + crash

- **Date:** 2026-05-11
- **Status:** Built; passes typecheck + 382 app tests + lint. Validation pending in a live KSP session.
- **Builds on:** `2026-05-11-overnight-telemachus-consumers.md` (mission summary banner + flight history annotation).

## Why

The earlier work shipped `RecoverySummaryBanner` (an ephemeral banner that fires on `recovery.hasRecent` false→true and opens a modal with the full breakdown). That handler covers the post-recovery flow, but crashes go through their own snapshot path (`crash.lastCrash` / `crash.hasRecent`) and had no banner — only the badge on the FlightsManager row.

Architectural ask: flight endings should share one UI slot. Recovery and crash are two flavours of the same event ("the flight just ended"); the operator shouldn't have to look in two places to find the latest outcome.

Secondary fix: on page reload mid-new-flight, the previous flight's sticky `recovery.lastSummary` re-fired the banner because the announce baseline was per-session, not per-flight.

## What

Renamed `RecoverySummaryBanner` → `FlightOutcomeBanner` and unified both flows:

- Subscribes to `recovery.lastSummary` + `recovery.hasRecent` AND `crash.lastCrash` + `crash.hasRecent`.
- Picks the most-recent outcome by KSP UT (both events report `capturedAtUT` / `ut` in the same in-game time, direct numeric compare works).
- Renders type-appropriate banner colour + label:
  - Recovery: GO-green border, `VESSEL RECOVERED`, +funds/+sci/+rep.
  - Crash: NOGO-red border, `VESSEL DESTROYED`, parts lost + kerbals KIA.
- Tap opens a type-appropriate detail modal (`RecoveryDetail` keeps the existing science/parts/resources/crew breakdown; new `CrashDetail` shows flight-end stats — highest altitude/speed/G, ground distance, crew aboard with KIA flagged).
- On flight-id change (via `useFlight()` — re-renders whenever `BufferedDataSource.onFlightChange` fires), the announce baseline is reset to the current sticky outcome's `(kind, ut)`. The previous flight's snapshot won't re-fire the banner; only an outcome captured after the new flight starts will.

## Files

```
packages/app/src/components/FlightOutcomeBanner.tsx       (NEW — replaces RecoverySummaryBanner)
packages/app/src/components/RecoverySummaryBanner.tsx     (DELETED)
packages/app/src/screens/MainScreen.tsx                   (import rename)
packages/app/src/screens/StationScreen.tsx                (import rename)
feature_log/2026-05-11-flight-outcome-banner.md           (this entry)
```

No data-layer changes — `BufferedDataSource` already intercepts both `recovery.lastSummary` and `crash.lastCrash` and writes the outcome to the FlightRecord. The unification is purely on the consumer side.

## Open / pending

- Live verification: launch + crash + ensure red banner pops; launch + recover + ensure green banner pops; reload page mid-new-flight after a previous recovery and confirm no spurious banner.
- The `BufferedDataSource` idempotence keys (`lastAppliedRecoveryAtUT` / `lastAppliedCrashAtUT`) deliberately do NOT reset on new-flight detection. The same UT can't be applied twice, and the next outcome will have a different UT — so a new flight that ends doesn't get the previous flight's outcome by accident. Documented in case future work touches this.
- Future "sausage left of the FAB" idea (from the original recovery feature notes) — a hover-over-FAB sausage showing the current scene with a contextual recovery option — would naturally consume the same `FlightOutcomeBanner` data. Out of scope here.
