# U4 — kerbcast Uplink — report

**Branch:** `uplink-kerbcast` (worktree `/Users/jon.pepler/personal/gonogo-uplinks/kerbcast`)
**Status:** done (scope-adjusted — see below)
**Commits:**
- `e5efc23b` feat(sitrep-client): useViewClock — first-class accessor for the one shared delay authority
- `b537d486` test(kerbcast): prove the real ViewClock drives media release + telemetry certainty off one authority

**Tests:** sitrep-client 322 passed (37 files, +4), kerbcast 77 passed (8 files, +4). Biome + full-turbo typecheck (15 packages) green via pre-commit. No C# touched → dotnet unchanged from the green base.

**Contract:** no `[SitrepContract]` wire types added. ContractVersion stays **2.1**; shape baseline untouched.

## What this task actually was

The brief pre-dates the foundation absorbing most of the kerbcast delay work. On the base
`sitrep-streaming` HEAD the following already exist and are green:
- `@gonogo/kerbcast` `KerbcastDataSource` (WebRTC + camera list + slot pool + broker/station path + relay TURN-on-demand), registered as a `DataSource` so it surfaces in the Data Sources widget with mapped `DataSourceStatus`.
- `DelayedPlayoutBuffer` — UT-stamped media playout keyed on an injected `DelayClockLike` (`confirmedEdgeUt` + `onFrame`), with cap/keyframe eviction, flush/resync, delay=0 passthrough. Fully unit-tested.
- `useKerbcastStream(flightId, delay?)` — plumbs a delay option (view clock + captureUt + resetEpoch) through to the buffer; decoupled from sitrep-client by design (structural `DelayClockLike`, no import).

So this is **not** a C# Sitrep uplink — kerbcast is its own sibling mod (RT-free, own packaging already in the sister repo). No `[SitrepUplink]`/manifest/`AddSampledSource` work applies. This was pure JS-side alignment on the **single delay authority** seam, which is the sharpest risk called out in the brief.

## What I delivered

1. **`useViewClock()` / `useViewClockOptional()`** in `@gonogo/sitrep-client` (`context.tsx`, exported from `index.ts`). Returns the provider's ONE `ViewClock` (`store.clock`) — the single delay authority. This is the missing formal accessor: previously a widget could only reach it via `useTelemetryStore().clock`. The returned `ViewClock` is structurally exactly the media buffer's `DelayClockLike`, so the app can hand it straight into `useKerbcastStream`'s `delay.view` while kerbcast keeps importing nothing from sitrep-client. Tests assert: same instance as the store's clock; one instance shared across sibling consumers; satisfies the `confirmedEdgeUt`+`onFrame` surface; throwing vs optional-undefined outside a provider.

2. **Real-ViewClock integration proof** in `@gonogo/kerbcast` (`DelayedPlayoutBuffer.viewclock.integration.test.ts`). Drives `DelayedPlayoutBuffer` with the actual `ViewClock` (not the `manualClock` double) to nail the invariant that video and telemetry cross together off ONE authority: a media frame stamped UT=X releases at exactly the `confirmedEdgeUt()` crossing that flips a telemetry sample at UT=X from `predicted`→`confirmed`. Covers delay=0 passthrough, delay>0 (both surfaces held back by the same seconds), a frame past the edge held while telemetry is predicted, and the shared epoch-reset flush. Uses the already-present `@gonogo/sitrep-client` devDependency.

## Concerns / remaining cross-repo step (ViewClock sharing)

- **The seam is complete and proven; the on-screen `CameraFeed` widget cannot yet consume it.** The visible `CameraFeed` renders via `SharedCameraFeed` from `@jonpepler/kerbcast-react@1.2.0`, whose `CameraFeedProps` (inspected in this worktree) has **no** delay / stream-transform / clock hook — it owns its `<video>` srcObject internally. Spec §5.2 states exactly this future step ("`CameraFeed` swaps its raw `MediaStream` for the buffer's delayed output") as a **kerbcast-SDK-side add** in the sibling repo, which is not checked out here. At today's `delaySeconds()===0` (LAN default) this is a strict passthrough anyway, so there is **zero functional gap today**; the gap is future comms-delay video, blocked on that SDK feature. The one real consumer of `useKerbcastStream` (`DistanceToTarget`'s thumbnail) also currently calls it without the delay option — wiring it needs the app to pass `useViewClockOptional()` down, deferred with the SDK step so it lands as one coherent change rather than a half-wired path.
- **No second clock exists anywhere.** `useViewClock` returns the store's instance by identity; the buffer never computes `arrival + delay` (release-on-`confirmedEdgeUt` only); the delay>0 test proves the authority's delay applies identically to both surfaces. This is the single-delay-authority guarantee the brief flagged.
- **Status alignment:** `KerbcastDataSource.status` already maps `KerbcastConnectionState`→`DataSourceStatus` and appears in the Data Sources widget — the JS-side equivalent of uplink discovery/status. No further alignment is meaningful without a C# uplink, which kerbcast (separate mod) is not.
