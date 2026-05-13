# Banner primitives extraction — SourceOfflineBanner pinned, BannerPill shared

- **Date:** 2026-05-12
- **Commit:** `f803be6`
- **Validation:** ⏳ pending — landed and tested in CI; visible behaviour against a real dashboard not yet eyeballed.

## Why

`SustainedFailureBanner` was a flow element inside the dashboard tree — it scrolled with the page instead of sticking to the screen. That defeated its purpose (you'd lose sight of "SOURCE OFFLINE" the moment you scrolled away from the affected widget). Other status banners (`SignalLossBanner`, `VersionMismatchBanner`) already used a fixed-position top-anchored pill chrome, but each defined that chrome inline.

Two cleanups in one pass: pin the source-offline banner to the viewport, and extract the shared pill chrome so future banners pick it up automatically.

## What

### `SourceOfflineBanner` (new in `@gonogo/ui`)

Presentational component for the source-offline list. Fixed at the **bottom** of the viewport with `safe-area-inset-bottom` padding (so it clears iOS home indicators, etc.). Takes an `entries: { id, name, status, elapsedMs }[]` prop — pure render, no data subscriptions.

The data-watching wrapper stays in `packages/app/src/components/SustainedFailureBanner.tsx`: subscribes to `useDataSources` + `useStreamSources`, walks the connection state via the existing `since`-map / 15s threshold logic, and feeds the computed entries into `<SourceOfflineBanner />`. Pattern matches the existing `SignalLossIndicator` (data) / `SignalLossBanner` (chrome) split.

### `BannerPill` primitive (new in `@gonogo/ui`)

Shared top-anchored pill chrome — fixed position, coloured border + dot + text driven by a single `accent` prop. Used by:

- `SignalLossBanner` — accent = NOGO red, pulsing dot
- `VersionMismatchBanner` — accent = WARN amber, static dot

Props: `accent`, optional `top`/`zIndex`/`glow`/`pulse`, optional `role` (defaults `"status"`, can override to `"alert"`) with auto-derived `aria-live`. Callers control `top` and `zIndex` so multiple pills can stack.

Renamed away from "StatusPill" to avoid collision with `Readout`'s existing inline status chip — a Readout puts a tiny status pill *inside* a widget, this puts a banner pill *over* the whole viewport, and shipping both as "StatusPill" would have been a maintenance trap.

## Files

```
packages/ui/src/SourceOfflineBanner.tsx                  (NEW)
packages/ui/src/BannerPill.tsx                           (NEW)
packages/ui/src/SignalLossBanner.tsx                     (now uses BannerPill)
packages/ui/src/VersionMismatchBanner.tsx                (now uses BannerPill)
packages/ui/src/index.ts                                 (export new primitives)
packages/app/src/components/SustainedFailureBanner.tsx   (slimmed to a data wrapper)
```

No persistence-schema change, no peer-protocol change — purely a `@gonogo/ui` surface refactor plus one visual fix (bottom-anchor on source-offline).

## Outstanding

- Live verify: kill a data source for 15+ seconds. The SOURCE OFFLINE banner should appear pinned to the bottom of the viewport and stay visible while scrolling the dashboard.
- Restore the data source. The banner should disappear (entries empty → returns `null`).
- Confirm `SignalLossBanner` + `VersionMismatchBanner` still render identically against their previous designs (pulse vs static dot, accent colour, copy).
- On mobile, confirm the banner clears the home-indicator safe area without being cut off.
