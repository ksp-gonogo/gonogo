import type {
  CareerContract,
  VesselIdentity,
  VesselOrbit,
  VesselTarget,
  WarpState,
} from "@ksp-gonogo/sitrep-sdk";
import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { TelemetryClient } from "./client";
import { DelayAuthority } from "./delay-authority";
import { dvLegacyScalarsChannel } from "./dv-legacy-scalars";
import {
  dvCurrentStageResourceChannel,
  dvCurrentStageResourceMaxChannel,
} from "./dv-stage-resources";
import { vesselManeuverLegacyChannel } from "./maneuver-legacy";
import { mapCommand } from "./map-command";
import { mapTopic } from "./map-topic";
import { StreamRecorder, type StreamRecorderOptions } from "./replay-recorder";
import { spaceCenterStateChannel } from "./space-center-state";
import { systemStateChannel } from "./system-state";
import type { DerivedChannelDefinition } from "./timeline-store";
import { TimelineStore } from "./timeline-store";
import { systemUplinkHealthChannel } from "./uplink-health";
import type { VesselState } from "./vessel-state";
import { vesselStateChannel } from "./vessel-state";
import { ViewClock, type ViewClockOptions } from "./view-clock";

const TelemetryClientContext = createContext<TelemetryClient | undefined>(
  undefined,
);
const TimelineStoreContext = createContext<TimelineStore | undefined>(
  undefined,
);
const CarriedChannelsContext = createContext<ReadonlySet<string> | undefined>(
  undefined,
);

/**
 * Union `additions` into `previous`, returning `previous` UNCHANGED
 * (referentially) when nothing new was added — the monotonic-growth seam
 * behind `TelemetryProvider`'s carried-channels allowlist: adding a topic
 * can only move it from legacy->stream, never blank a widget. Never used
 * to shrink: a caller whose next render passes a SMALLER explicit
 * `carriedChannels` prop (or
 * whose transport's own `declaredChannels` shrinks — not expected in
 * practice, but not relied upon either) does not lose previously-carried
 * topics. This is what makes "promoting a topic" a one-way ratchet for the
 * lifetime of one mounted provider, never a mid-session reversal.
 */
function unionGrow(
  previous: ReadonlySet<string>,
  additions: Iterable<string>,
): ReadonlySet<string> {
  let next: Set<string> | undefined;
  for (const topic of additions) {
    if (previous.has(topic)) continue;
    if (!next) next = new Set(previous);
    next.add(topic);
  }
  return next ?? previous;
}

/**
 * Schedule `cb` to run on the next animation frame, falling back to a
 * microtask when `requestAnimationFrame` isn't available (SSR, and jsdom —
 * verified `jsdom@29` has no `requestAnimationFrame` at all, so this is the
 * path every test in this package actually exercises; there is no real-timer
 * race to make a test flaky). The coalescing primitive behind
 * `TelemetryProvider`'s ingest -> `beginFrame()` scheduling below.
 * Returns a cancel function.
 */
function scheduleFrame(cb: () => void): () => void {
  if (typeof requestAnimationFrame === "function") {
    const handle = requestAnimationFrame(cb);
    return () => cancelAnimationFrame(handle);
  }
  let cancelled = false;
  queueMicrotask(() => {
    if (!cancelled) cb();
  });
  return () => {
    cancelled = true;
  };
}

export interface TelemetryProviderProps {
  client: TelemetryClient;
  children: ReactNode;
  /**
   * Advanced override: supply a pre-built `TimelineStore` (e.g. one with
   * extra derived channels registered, or non-default `ViewClock` options —
   * a scrub UI, a fixed replay delay) instead of the default one this
   * provider builds. When omitted, `TelemetryProvider` builds one itself —
   * see this component's own doc comment.
   */
  store?: TimelineStore;
  /** Only consulted when `store` is omitted — options for the default `ViewClock` this provider builds. */
  viewClockOptions?: ViewClockOptions;
  /**
   * Explicit per-topic promotion list (the carried-channels allowlist gate,
   * `./carried-channels.ts`) — the "dev-first per-topic opt-in" half of the
   * allowlist, alongside `client.declaredChannels` (the transport's own
   * served-channel declaration). Union of the two is what `useDataValue`'s shim
   * (`@ksp-gonogo/core`) consults before ever routing a MAPPED topic to the
   * stream instead of legacy. Monotonic: a topic named here (or ever
   * declared by the transport) stays carried for the life of this mounted
   * provider even if a later render omits it — see `unionGrow`. Omit
   * entirely to carry only whatever the transport itself declares.
   */
  carriedChannels?: Iterable<string>;
}

/**
 * Supplies a `TelemetryClient` — and a `TimelineStore` fed from that
 * client's wire — to the component tree via context.
 *
 * **The bridge:** without this provider, nothing in production ever
 * constructed a `TimelineStore` or registered a derived channel on one, so
 * `vessel.state.*` (and any future derived channel) was permanently
 * unreachable through `useStream`/`useDataValue` even once a provider was
 * mounted — the derivation machinery in `vessel-state.ts`/
 * `timeline-store.ts` existed but was wired to nothing. This provider is
 * what closes that gap:
 *
 * - Unless `store` is supplied, it builds ONE `TimelineStore` (backed by a
 *   `ViewClock`) per `client` and registers the production derived channels
 *   (`vesselStateChannel` today; extend `PRODUCTION_DERIVED_CHANNELS` below
 *   as more land) on it.
 * - `client.attachStore(store)` feeds every incoming `stream-data` wire
 *   frame into the store's per-topic timelines.
 * - `client.subscribeStore(...)` schedules a `store.beginFrame()` via
 *   `scheduleFrame` — a `requestAnimationFrame`
 *   (falling back to a microtask off the main thread when rAF isn't
 *   available). Multiple ingests landing before that scheduled callback
 *   fires are coalesced into the ONE `beginFrame()` call it makes, honoring
 *   `TimelineStore.beginFrame`'s own doc ("call once per animation frame /
 *   read cycle... never once per read") instead of re-minting a fresh
 *   `FrameToken` — and re-running `deriveVesselState`'s Kepler solve — on
 *   every single message in a burst. This is what makes
 *   `useStream`/`useStreamStatus`/`useCertainty`'s `useSyncExternalStore`
 *   subscriptions (keyed off `store.subscribeFrame`) actually re-render.
 *
 * `useStream`/the `@ksp-gonogo/core` `useDataValue` shim both read through
 * `store.sample(topic, store.currentFrame())` now (never `client.getValue`
 * directly) so raw AND derived topics resolve through the exact same
 * surface — see `use-stream.ts`.
 */
export function TelemetryProvider({
  client,
  children,
  store: providedStore,
  viewClockOptions,
  carriedChannels: carriedChannelsProp,
}: TelemetryProviderProps) {
  // biome-ignore lint/correctness/useExhaustiveDependencies: viewClockOptions is deliberately read only ONCE, at construction of a store this provider owns — a caller passing a fresh inline options object every render must not tear down and rebuild the store/clock each time. `client` IS a dependency for the auto-built branch below — see that branch's own comment for why; it's listed here (rather than split into two memos) so a `providedStore` caller's `client` swap still re-triggers the (no-op, `providedStore`-returning) factory, keeping this one memo the single source of truth `store` identity is derived from.
  const { store, delayAuthority } = useMemo(() => {
    if (providedStore) return { store: providedStore, delayAuthority: null };
    // Auto-built store must rebuild on `client` identity change: `client`
    // was previously omitted from this memo's deps (on the theory that the
    // store "isn't tied to a specific client instance") — but an
    // AUTO-BUILT store has no owner other than this provider, so a
    // reconnect/client-swap that hands in a fresh `TelemetryClient` would
    // leave the old store (with its topics/timelines still keyed off the
    // old client's wire) permanently attached instead of resetting. A
    // caller-`providedStore` is still exempt — that store is the caller's
    // own, its lifetime is deliberately independent of `client` (see the
    // `attachStore`/ `subscribeStore` effects below, which still re-wire IT
    // to a new `client` without rebuilding it).
    // The SINGLE delay-wiring point. The auto-built clock's `delaySeconds`
    // reads the `DelayAuthority` (fed from `comms.delay` by the effect
    // below) instead of the `() => 0` stub, so the certainty horizon /
    // predicted-present lead is sized to the real
    // one-way light-time. This is legibility over the already-server-delayed
    // wire, NOT enforcement (the mod's reveal gate already withheld the
    // samples). A caller who passes an explicit `viewClockOptions.delaySeconds`
    // (e.g. a fixed replay delay) still wins — the authority is only the
    // default. Media (kerbcast) reads this same clock, so it aligns for free.
    const authority = new DelayAuthority();
    const built = new TimelineStore(
      new ViewClock({
        ...viewClockOptions,
        delaySeconds: viewClockOptions?.delaySeconds ?? authority.delaySeconds,
      }),
    );
    for (const channel of PRODUCTION_DERIVED_CHANNELS) {
      built.registerDerivedChannel(channel);
    }
    return { store: built, delayAuthority: authority };
  }, [providedStore, client]);

  // The carried-channels allowlist (see `./carried-channels.ts`): seeded
  // from `client.declaredChannels` (the transport's own served-topic
  // declaration) unioned with the explicit `carriedChannels` promotion-list
  // prop. Persists and only ever GROWS across renders of this same provider
  // INSTANCE (`unionGrow` — the one-way ratchet: "monotonic... adding a
  // topic can only move it from legacy->stream, never blank a widget"),
  // even if a later render's `carriedChannelsProp` shrinks. Only resets on
  // a genuine `client` identity change (`carriedClientRef` tracks which
  // client the current set belongs
  // to) — a fresh session, matching the auto-built store's own
  // client-identity reset above; a client swap starts a new allowlist rather
  // than carrying stale entries from a transport that's no longer attached.
  const carriedClientRef = useRef<TelemetryClient | null>(null);
  const [carriedChannels, setCarriedChannels] = useState<ReadonlySet<string>>(
    () => {
      carriedClientRef.current = client;
      return unionGrow(
        new Set(client.declaredChannels),
        carriedChannelsProp ?? [],
      );
    },
  );

  useEffect(() => {
    const additions = [
      ...client.declaredChannels,
      ...(carriedChannelsProp ?? []),
    ];
    if (carriedClientRef.current !== client) {
      carriedClientRef.current = client;
      setCarriedChannels(new Set(additions));
      return;
    }
    setCarriedChannels((previous) => unionGrow(previous, additions));
  }, [client, carriedChannelsProp]);

  useEffect(() => client.attachStore(store), [client, store]);
  // Registers this provider's clock as the non-React `getViewUt()` accessor's
  // source — see `activeViewClock`'s doc comment above. Also registers the
  // store itself as `getVesselOrbit()`/`getVesselTarget()`/
  // `getVesselIdentity()`/`getVesselState()`'s source — see
  // `activeTimelineStore`'s doc comment.
  useEffect(() => {
    activeViewClock = store.clock;
    activeTimelineStore = store;
    return () => {
      if (activeViewClock === store.clock) activeViewClock = undefined;
      if (activeTimelineStore === store) activeTimelineStore = undefined;
    };
  }, [store]);
  // Registers the client itself as `getActiveTelemetryClient()`'s source —
  // the plain-class (non-hook) command-dispatch equivalent of
  // `useTelemetryClientOptional()`, same rationale as `activeViewClock`/
  // `activeTimelineStore` above.
  useEffect(() => {
    activeTelemetryClient = client;
    return () => {
      if (activeTelemetryClient === client) activeTelemetryClient = undefined;
    };
  }, [client]);
  // Registers the carried-channels allowlist as `getActiveCarriedChannels()`'s
  // source — the plain-class equivalent of `useCarriedChannelsOptional()`.
  // Re-runs on every allowlist growth (not just client identity change) so a
  // plain-class caller's routing decision sees the same monotonically-growing
  // set a hook-based reader would.
  useEffect(() => {
    activeCarriedChannels = carriedChannels;
    return () => {
      if (activeCarriedChannels === carriedChannels)
        activeCarriedChannels = undefined;
    };
  }, [carriedChannels]);
  // Keep the auto-built clock's delay value current by subscribing the
  // `DelayAuthority` to `comms.delay`. Skipped when
  // the caller supplied their own `store` (they own its clock's delay wiring),
  // matching the auto-built store's client-identity lifetime above.
  useEffect(() => {
    if (!delayAuthority) return;
    return delayAuthority.attach(client);
  }, [client, delayAuthority]);
  useEffect(() => {
    // Coalesce to (at most) one `beginFrame()` per animation-frame tick,
    // instead of one per `stream-data` message — see
    // `scheduleFrame` and this component's own doc comment above.
    let scheduled = false;
    let cancelScheduled: (() => void) | null = null;

    const runBeginFrame = () => {
      scheduled = false;
      cancelScheduled = null;
      store.beginFrame();
    };

    const scheduleBeginFrame = () => {
      if (scheduled) return; // already coalescing this frame's ingests
      scheduled = true;
      cancelScheduled = scheduleFrame(runBeginFrame);
    };

    const unsubscribe = client.subscribeStore(scheduleBeginFrame);
    return () => {
      unsubscribe();
      cancelScheduled?.();
    };
  }, [client, store]);

  return (
    <TelemetryClientContext.Provider value={client}>
      <TimelineStoreContext.Provider value={store}>
        <CarriedChannelsContext.Provider value={carriedChannels}>
          {children}
        </CarriedChannelsContext.Provider>
      </TimelineStoreContext.Provider>
    </TelemetryClientContext.Provider>
  );
}

/**
 * Derived channels every `TelemetryProvider`-built default store registers.
 * A caller that needs a channel NOT in this list yet (or wants to omit one)
 * supplies its own pre-built `store` prop instead of relying on the
 * default.
 */
export const PRODUCTION_DERIVED_CHANNELS: DerivedChannelDefinition<unknown>[] =
  [
    vesselStateChannel as DerivedChannelDefinition<unknown>,
    systemStateChannel as DerivedChannelDefinition<unknown>,
    systemUplinkHealthChannel as DerivedChannelDefinition<unknown>,
    spaceCenterStateChannel as DerivedChannelDefinition<unknown>,
    dvCurrentStageResourceChannel as DerivedChannelDefinition<unknown>,
    dvCurrentStageResourceMaxChannel as DerivedChannelDefinition<unknown>,
    vesselManeuverLegacyChannel as DerivedChannelDefinition<unknown>,
    dvLegacyScalarsChannel as DerivedChannelDefinition<unknown>,
  ];

/** Reads the `TelemetryClient` supplied by the nearest `TelemetryProvider`. */
export function useTelemetryClient(): TelemetryClient {
  const client = useContext(TelemetryClientContext);
  if (!client) {
    throw new Error(
      "useTelemetryClient must be used within a TelemetryProvider",
    );
  }
  return client;
}

/**
 * Non-throwing variant of `useTelemetryClient` — `undefined` when no
 * `TelemetryProvider` is mounted, instead of throwing.
 *
 * Exists for compatibility shims (`@ksp-gonogo/core`'s `useDataValue` →
 * `useStream` migration) that must keep working — falling back to
 * a legacy code path — during the migration window before every screen
 * mounts a `TelemetryProvider`. Ordinary SDK-native call sites should keep
 * using `useTelemetryClient` so a missing provider fails loudly.
 */
export function useTelemetryClientOptional(): TelemetryClient | undefined {
  return useContext(TelemetryClientContext);
}

/**
 * Sibling hook to `TelemetryProvider` — the mission-recording tap point
 * (`StreamRecorder`, `./replay-recorder.ts`). Builds (and memoizes) a
 * `StreamRecorder` bound to the nearest `TelemetryProvider`'s client;
 * `undefined` when no provider is mounted, matching every other
 * `*Optional`-shaped read in this file.
 *
 * Zero overhead when unused: a `StreamRecorder` registers no listener on the
 * client until its own `start()` is called, so a caller that never presses
 * "record" (or has mission history disabled) pays nothing beyond the one
 * object allocation — no wire subscription, no message tap.
 *
 * `recordAllTopics` is read once at construction (like
 * `viewClockOptions` on `TelemetryProvider` itself) — flip it by
 * `stop()`ping any in-progress recording and letting this hook rebuild a
 * fresh recorder on the next render with the new option.
 */
export function useStreamRecorder(
  options?: StreamRecorderOptions,
): StreamRecorder | undefined {
  const client = useTelemetryClientOptional();
  const recordAllTopics = options?.recordAllTopics ?? false;
  return useMemo(
    () =>
      client ? new StreamRecorder(client, { recordAllTopics }) : undefined,
    [client, recordAllTopics],
  );
}

/**
 * Reads the `TimelineStore` supplied by the nearest `TelemetryProvider`.
 * Always mounted alongside the client by `TelemetryProvider` (auto-built
 * if the `store` prop was omitted) — throws if no provider is in
 * the tree, matching `useTelemetryClient`'s contract.
 */
export function useTelemetryStore(): TimelineStore {
  const store = useContext(TimelineStoreContext);
  if (!store) {
    throw new Error(
      "useTelemetryStore must be used within a TelemetryProvider",
    );
  }
  return store;
}

/**
 * Non-throwing variant of `useTelemetryStore` — `undefined` when no
 * `TelemetryProvider` is mounted. Same rationale as
 * `useTelemetryClientOptional`: the `@ksp-gonogo/core` `useDataValue`
 * compatibility shim needs both the client AND the store, without throwing,
 * to decide whether it can route a call through the new stream pipeline.
 */
export function useTelemetryStoreOptional(): TimelineStore | undefined {
  return useContext(TimelineStoreContext);
}

/**
 * The nearest `TelemetryProvider`'s **one** `ViewClock` — THE single delay
 * authority. Every surface that must stay delay-consistent with telemetry
 * (staleness, predicted-view, and crucially the kerbcast media
 * `DelayedPlayoutBuffer`) reads its release/certainty edge off
 * THIS clock instance, never a second one it constructs itself. A media frame
 * and a telemetry sample stamped the same UT therefore surface at the same
 * `confirmedEdgeUt()` crossing — a shared common-mode property.
 *
 * The returned `ViewClock` is structurally the `DelayClockLike` surface
 * (`confirmedEdgeUt` + `onFrame`) the media buffer depends on, so it can be
 * handed straight to `DelayedPlayoutBuffer`/`useKerbcastStream` — kerbcast
 * stays decoupled (it imports no sitrep-client type; the app passes this in).
 *
 * Throws if no `TelemetryProvider` is mounted, matching `useTelemetryStore`.
 */
/**
 * The read-only slice of `ViewClock` that delay-consistent consumers actually
 * need: the `confirmedEdgeUt` release/certainty edge and the `onFrame`
 * subscription. Narrowing the hook return to this `Pick` keeps consumers (the
 * kerbcast `DelayedPlayoutBuffer` seam, camera widgets) from reaching for the
 * clock's mutating surface — they observe, they never drive it.
 */
export type ViewClockView = Pick<ViewClock, "confirmedEdgeUt" | "onFrame">;

/**
 * The most recently mounted `TelemetryProvider`'s clock, tracked outside
 * React for non-hook callers (plain classes — trigger/alarm services — that
 * can't call `useViewUt`). Set/cleared by the registration effect in
 * `TelemetryProvider` below. In practice only one provider is mounted at a
 * time (the main screen's single stream); a guard on unmount stops a stale
 * provider's teardown from clobbering a still-live one's registration.
 *
 * Deliberately typed as `Pick<ViewClock, "viewUt">`, NOT the narrower
 * `ViewClockView` (`confirmedEdgeUt` + `onFrame`) `useViewClockOptional`
 * returns: `useViewUt`'s reactive value tracks `onFrame`'s per-frame
 * `viewUt()` callback argument, not `confirmedEdgeUt()` directly (the two
 * diverge whenever a scrub target is set — `viewUt()` honours it outright,
 * `confirmedEdgeUt()` never does, per that method's own doc comment) — so
 * `getViewUt()` below must read the exact same method to match `useViewUt`'s
 * contract, including under a pinned/scrubbed test clock.
 */
let activeViewClock: Pick<ViewClock, "viewUt"> | undefined;

export function useViewClock(): ViewClockView {
  return useTelemetryStore().clock;
}

/**
 * Non-throwing variant of `useViewClock` — `undefined` when no
 * `TelemetryProvider` is mounted. The natural call shape for an optional
 * consumer like a camera widget: it wires delayed playout onto the shared
 * clock when streaming is live and falls back to strict passthrough (the
 * `delaySeconds() === 0` case) otherwise, with no hard dependency on a
 * provider being in the tree.
 */
export function useViewClockOptional(): ViewClockView | undefined {
  return useTelemetryStoreOptional()?.clock;
}

/**
 * The current view time (UT seconds) as a reactive value — the ergonomic
 * "read view-UT directly" surface widgets need after the `t.universalTime`
 * DROP (it was never a stream; it IS the SDK view time the propagation already
 * evaluates at). Subscribes to the shared `ViewClock`'s per-frame `onFrame`
 * tick and returns the frozen `viewUt` for the current frame (respecting
 * scrub/predicted mode). `undefined` when no `TelemetryProvider` is mounted or
 * before the first confirmed sample (the view time isn't finite yet) — the
 * natural "no stream / not synced" signal a widget can `??`-fall-back on.
 *
 * Per-frame reactive by design (the same rAF cadence the media buffer runs
 * on): a widget that reads view-UT for a live countdown re-renders each frame,
 * which is exactly what a live countdown requires. Callers that only need the
 * clock object (not a reactive value) should use `useViewClock` instead.
 */
export function useViewUt(): number | undefined {
  const clock = useViewClockOptional();
  const [viewUt, setViewUt] = useState<number | undefined>(() => {
    const seed = clock?.confirmedEdgeUt();
    return seed !== undefined && Number.isFinite(seed) ? seed : undefined;
  });
  useEffect(() => {
    if (!clock) {
      setViewUt(undefined);
      return;
    }
    return clock.onFrame((ut) =>
      setViewUt(Number.isFinite(ut) ? ut : undefined),
    );
  }, [clock]);
  return viewUt;
}

/**
 * The current REAL-time "vessel now" (UT seconds) as a reactive value —
 * `ViewClock.utNowEstimate()`, NOT the delay-gated `confirmedEdgeUt()`
 * `useViewUt` tracks. Every other live countdown in the app is rightly
 * delay-consistent (it's timing DELAYED craft telemetry, so it must lag by
 * the one-way light-time same as the data it's counting against) — but a
 * few channels are command-centre real-time bookkeeping instead of delayed
 * craft telemetry (e.g. `system.uplink.pending`'s dispatch/prediction
 * timestamps, stamped in real UT the instant a command leaves the ground
 * station). Timing THOSE against `useViewUt` makes them appear, and clear,
 * one whole one-way-delay late — this hook is the fix: it reads the same
 * `ViewClock` instance's `utNowEstimate()` (the undelayed UT(wall) fit)
 * instead, so a real-time bookkeeping value renders in step with the real
 * event, not the delayed view.
 *
 * Modeled directly on `useViewUt` — same `onFrame` subscription, same
 * seed-then-subscribe shape — except the per-frame callback recomputes
 * `clock.utNowEstimate()` itself rather than using the `viewUt` argument
 * `onFrame` hands it (that argument IS `clock.viewUt()`, the delayed/
 * scrubbable value `useViewUt` wants — not what this hook needs).
 *
 * `undefined` when no `TelemetryProvider` is mounted. Unlike `useViewUt`,
 * this is NOT gated on "before the first confirmed sample" — `utNowEstimate()`
 * has a well-defined value (0, or the last observed sample UT) from the
 * moment a clock exists, since real-time bookkeeping has no "confirmed vs.
 * predicted" distinction to wait out.
 */
export function useUtNow(): number | undefined {
  const store = useTelemetryStoreOptional();
  const clock = store?.clock;
  const [utNow, setUtNow] = useState<number | undefined>(() => {
    const seed = clock?.utNowEstimate();
    return seed !== undefined && Number.isFinite(seed) ? seed : undefined;
  });
  useEffect(() => {
    if (!clock) {
      setUtNow(undefined);
      return;
    }
    return clock.onFrame(() => {
      const estimate = clock.utNowEstimate();
      setUtNow(Number.isFinite(estimate) ? estimate : undefined);
    });
  }, [clock]);
  return utNow;
}

/**
 * Non-React `useViewUt()` equivalent — for callers that can't use hooks
 * (plain classes like `LocalManeuverTriggerService`, the maneuver-trigger and
 * alarm host services). Reads `viewUt()` off whichever `TelemetryProvider`
 * most recently mounted (`activeViewClock`), the same method `onFrame`
 * hands `useViewUt`'s per-frame callback — so it follows the exact same
 * delay-consistent, scrub-respecting clock, just polled on demand instead of
 * per-frame. `undefined` when no provider has ever mounted, or before any
 * live/scrubbed value is available — the same "no stream / not synced"
 * contract `useViewUt` returns before its first frame.
 */
export function getViewUt(): number | undefined {
  const ut = activeViewClock?.viewUt();
  return ut !== undefined && Number.isFinite(ut) ? ut : undefined;
}

/**
 * Test-only escape hatch: registers `clock` as `getViewUt()`'s source
 * directly, without mounting a `TelemetryProvider` — for a host-service unit
 * test (`AlarmHostService`, `ManeuverTriggerHostService`) that drives its own
 * fake telemetry reader and has no React tree to render at all. Pass
 * `undefined` to clear; a test's `afterEach` should always do this so a
 * later, unrelated suite's `getViewUt()` call can't see a stale clock left
 * over from this one.
 */
export function setActiveViewClockForTests(
  clock: Pick<ViewClock, "viewUt"> | undefined,
): void {
  activeViewClock = clock;
}

/**
 * The most recently mounted `TelemetryProvider`'s `TimelineStore`, tracked
 * outside React for the same non-hook callers `activeViewClock` serves —
 * plain classes (`LocalManeuverTriggerService`, the maneuver-trigger and
 * alarm host services) that need a point-in-time read of a fixed Topic
 * (`vessel.orbit`, `vessel.target`, `vessel.identity`, the derived
 * `vessel.state`) without subscribing. Narrowed to the two methods an
 * on-demand sample needs (`sample`/`currentFrame`), matching
 * `activeViewClock`'s narrowing to just `viewUt`. Set/cleared by the same
 * registration effect in `TelemetryProvider` above.
 */
let activeTimelineStore:
  | Pick<TimelineStore, "sample" | "currentFrame" | "subscribeFrame">
  | undefined;

/**
 * The most recently mounted `TelemetryProvider`'s `TelemetryClient`, tracked
 * outside React for the same non-hook callers `activeViewClock`/
 * `activeTimelineStore` serve — the plain-class equivalent of
 * `useTelemetryClientOptional()`. Paired with `activeCarriedChannels` below,
 * this is what lets a plain class (`GoNoGoHostService`) dispatch a command
 * through the new stream (`dispatchActiveCommand`) with the exact same
 * carried-gated routing decision `useCommand` (`@ksp-gonogo/core`) makes for
 * a hook-based widget.
 */
let activeTelemetryClient: TelemetryClient | undefined;

/**
 * The most recently mounted `TelemetryProvider`'s carried-channels allowlist,
 * tracked outside React — the plain-class equivalent of
 * `useCarriedChannelsOptional()`. See `activeTelemetryClient`'s doc comment.
 */
let activeCarriedChannels: ReadonlySet<string> | undefined;

/**
 * Reads `topic` off whichever `TelemetryProvider` most recently mounted
 * (`activeTimelineStore`), the same `store.sample(topic, store.currentFrame())`
 * call `useStream`/`useTelemetry`'s canonical overload make — so a non-hook
 * caller sees the exact same value a widget's `useTelemetry(topic)` would on
 * the same frame, just polled on demand instead of reactively. Returns
 * `undefined` when no provider has ever mounted, or before any point has
 * landed for `topic` — the same "not synced yet" contract `useStream`
 * returns before its first frame. Does NOT itself ensure `topic` is
 * subscribed on the wire (unlike `useStream`'s `subscribe`, which ref-counts
 * a `client.subscribe` for the resolved raw inputs) — a plain-class caller
 * relies on some OTHER live subscriber (typically a mounted widget reading
 * the same topic) already keeping the data flowing, exactly like
 * `getViewUt()` relies on the provider's own `ViewClock` ticking regardless
 * of subscribers.
 *
 * Exported (beyond the fixed `getVesselOrbit`/`getVesselTarget`/
 * `getVesselIdentity`/`getVesselState` wrappers below, each just this
 * function bound to one Topic) for plain-class callers that need an
 * ARBITRARY topic decided at call time — `GoNoGoHostService`'s
 * `vessel.state.met` read, the same "dynamic topic" shape `useTelemetry`'s
 * own doc comment already documents for the hook case.
 */
export function sampleActiveTopic<T>(topic: string): T | undefined {
  if (!activeTimelineStore) return undefined;
  const point = activeTimelineStore.sample<T>(
    topic,
    activeTimelineStore.currentFrame(),
  );
  return point ? (point.payload as T | undefined) : undefined;
}

/**
 * Non-React equivalent of `useTelemetry("vessel.orbit")` — the vessel's own
 * Keplerian orbit elements (`sma`/`ecc`/`inc`/`lan`/`argPe`/`mu`/...). For
 * plain-class callers (`LocalManeuverTriggerService`, the maneuver-trigger
 * host service) that used to read the equivalent `o.*` legacy keys off
 * `getDataSource(...)` one field at a time.
 */
export function getVesselOrbit(): VesselOrbit | undefined {
  return sampleActiveTopic<VesselOrbit>("vessel.orbit");
}

/**
 * Non-React equivalent of `useTelemetry("vessel.target")` — the current
 * target's identity, relative kinematics, and (when it has one) orbit. The
 * replacement for the legacy `tar.o.*` keys' per-field reads.
 */
export function getVesselTarget(): VesselTarget | undefined {
  return sampleActiveTopic<VesselTarget>("vessel.target");
}

/**
 * Non-React equivalent of `useTelemetry("vessel.identity")` — vessel name,
 * type, situation, parent body index. The replacement for the legacy
 * `v.name` read.
 */
export function getVesselIdentity(): VesselIdentity | undefined {
  return sampleActiveTopic<VesselIdentity>("vessel.identity");
}

/**
 * Non-React equivalent of `useTelemetry("vessel.state")` — the derived
 * apoapsis/periapsis/time-to-apsis/true-anomaly/orbital-speed/radius/period/
 * body-name fields `vessel-state.ts` computes from `vessel.orbit` +
 * `vessel.target` + `vessel.identity` + `system.bodies`. The replacement for
 * the legacy `o.ApR`/`o.PeR`/`o.timeToAp`/`o.timeToPe`/`o.trueAnomaly`/
 * `o.orbitalSpeed`/`o.radius`/`o.period`/`v.body`/`tar.o.PeA`/`tar.o.period`/
 * `tar.o.trueAnomaly` per-field reads.
 */
export function getVesselState(): VesselState | undefined {
  return sampleActiveTopic<VesselState>(vesselStateChannel.topic);
}

/**
 * Non-hook, Value-restricted equivalent of `useTelemetry(dataSourceId, key)`'s
 * legacy overload — for a plain-class caller (alarm/maneuver-trigger threshold
 * evaluation) that needs to read an OPERATOR-PICKED legacy key, not one of a
 * fixed set decided at call time. `key` is resolved via `mapTopic` (same
 * migration table `useTelemetry` itself consults) and the resulting Topic is
 * sampled off the active `TimelineStore` via `sampleActiveTopic`. Narrowed to
 * `number` — the one type every threshold comparison
 * (`AlarmTrigger`/`ArmedTrigger`) needs — so a non-numeric or not-yet-arrived
 * read is a plain `undefined`, matching the legacy `getLatestValue` +
 * `typeof v === "number"` guard this replaces.
 *
 * Deliberately restricted to keys `mapTopic` actually resolves: the alarm/
 * trigger `DataKeyPicker` (see `@ksp-gonogo/data`'s `useValueKeys`) only ever
 * offers keys in that resolvable set, so an unmapped key here means a stale
 * persisted `dataKey` from before that restriction landed — `undefined` is
 * the correct, safe answer (the trigger simply never matches), not a crash.
 */
export function getValue(
  dataSourceId: string,
  key: string,
): number | undefined {
  const topic = mapTopic(dataSourceId, key);
  if (topic === undefined) return undefined;
  const value = sampleActiveTopic<unknown>(topic);
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

/**
 * Non-React equivalent of `useTelemetry("time.warp")` — the whole `WarpState`
 * record (`warpRate`/`warpRateIndex`/`warpMode`/`paused`). Replaces the
 * legacy `t.timeWarp`/`t.currentRateIndex`/`t.currentRate`/`t.warpMode`
 * per-field reads `WarpObserver` used to make against the `"data"`
 * `DataSource`.
 */
export function getWarpState(): WarpState | undefined {
  return sampleActiveTopic<WarpState>("time.warp");
}

/**
 * Non-React equivalent of `useTelemetry("career.status.contracts.active")` — the
 * career mode's currently-active contract list, off `career.status`'s
 * `contracts.active` raw-field subtopic. Replaces the legacy
 * `getLatestValue("contracts.active")` read `AlarmStateMachine`'s
 * contract-parameter trigger used to make.
 */
export function getContractsActive(): CareerContract[] | undefined {
  return sampleActiveTopic<CareerContract[]>("career.status.contracts.active");
}

/**
 * Non-hook equivalent of `useTelemetryClientOptional()` — the currently
 * mounted `TelemetryProvider`'s `TelemetryClient`, or `undefined` when none
 * is mounted. See `activeTelemetryClient`'s doc comment.
 */
export function getActiveTelemetryClient(): TelemetryClient | undefined {
  return activeTelemetryClient;
}

/**
 * Non-hook equivalent of `useCarriedChannelsOptional()`. See
 * `activeCarriedChannels`'s doc comment.
 */
export function getActiveCarriedChannels(): ReadonlySet<string> | undefined {
  return activeCarriedChannels;
}

/** Outcome of `dispatchActiveCommand` — see that function's doc comment. */
export type DispatchActiveCommandResult =
  | { routed: true; settled: Promise<void> }
  | { routed: false };

/**
 * Non-hook equivalent of `@ksp-gonogo/core`'s `useCommand` shim — for a plain
 * class (`GoNoGoHostService`) that needs the exact same "mapped + carried ->
 * dispatch through the stream, else fall back to legacy" routing decision a
 * hook-based widget gets, without a render tree to call `useCallback` from.
 *
 * Mirrors `useCommand`'s own logic exactly (see that hook's doc comment for
 * the full rationale): resolves `action` via `mapCommand`, using
 * `sampleActiveTopic` for the toggle -> absolute arg-shape bridge's
 * `getCurrentValue` reader; dispatches via `TelemetryClient.dispatch` only
 * when a provider is mounted AND the mapped command topic is carried.
 *
 * **Deliberately SYNCHRONOUS in its routing decision** (not `async`) — a
 * caller must be able to check `routed` in the SAME tick as the call, so a
 * `!routed` fallback to legacy `DataSource.execute(action)` fires exactly
 * when `useCommand`'s own synchronous fallback branch would, not one
 * microtask later. Only the ROUTED case is genuinely asynchronous (the real
 * dispatch round trip) — its `settled` promise never rejects, matching
 * `execute()`'s fire-and-forget contract, but resolving it is the caller's
 * business, not something worth blocking the routing decision on.
 */
export function dispatchActiveCommand(
  dataSourceId: string,
  action: string,
): DispatchActiveCommandResult {
  const client = activeTelemetryClient;
  const carried = activeCarriedChannels;
  const mapped = mapCommand(dataSourceId, action, (topic) =>
    sampleActiveTopic(topic),
  );
  if (mapped && client && carried?.has(mapped.command)) {
    const { result } = client.dispatch(mapped.command, mapped.args);
    return {
      routed: true,
      settled: result.then(
        () => undefined,
        () => undefined,
      ),
    };
  }
  return { routed: false };
}

/**
 * Test-only escape hatch: registers `store` as
 * `getVesselOrbit()`/`getVesselTarget()`/`getVesselIdentity()`/
 * `getVesselState()`'s source directly, without mounting a
 * `TelemetryProvider` — mirrors `setActiveViewClockForTests`. Pass
 * `undefined` to clear; a test's `afterEach` should always do this so a
 * later, unrelated suite can't see a stale store left over from this one.
 */
export function setActiveTimelineStoreForTests(
  store:
    | Pick<TimelineStore, "sample" | "currentFrame" | "subscribeFrame">
    | undefined,
): void {
  activeTimelineStore = store;
}

/**
 * Test-only escape hatch: registers `client` as `dispatchActiveCommand`'s
 * source directly, without mounting a `TelemetryProvider` — for a
 * host-service unit test that needs to exercise the ROUTED (stream) branch
 * of a command dispatch (`WarpControl`, `AlarmHostService`'s onFire
 * action-group dispatch, the maneuver-trigger fire path) without a React
 * tree to render. Mirrors `setActiveTimelineStoreForTests`; pair with
 * `setActiveCarriedChannelsForTests` (a command only routes when its mapped
 * topic is carried). Pass `undefined` to clear.
 */
export function setActiveTelemetryClientForTests(
  client: TelemetryClient | undefined,
): void {
  activeTelemetryClient = client;
}

/**
 * Test-only escape hatch: registers `channels` as `dispatchActiveCommand`'s
 * carried-channels allowlist directly. See
 * `setActiveTelemetryClientForTests`'s doc comment. Pass `undefined` to
 * clear.
 */
export function setActiveCarriedChannelsForTests(
  channels: ReadonlySet<string> | undefined,
): void {
  activeCarriedChannels = channels;
}

/**
 * Non-React equivalent of subscribing to `store.subscribeFrame` — for a
 * plain-class caller that needs to re-run its own on-demand reads
 * (`getVesselOrbit()`/`getVesselTarget()`/`getVesselIdentity()`/
 * `getVesselState()`) whenever the active `TelemetryProvider` ingests a new
 * frame, the same "vessel/orbit data changed" signal a widget's
 * `useTelemetry` re-render would ride. Unlike `getViewUt()`/the sample
 * accessors above (pure point-in-time reads), this one DOES need a live
 * subscription — a plain class has no render loop to poll on. No-op
 * (returns a no-op unsubscribe) when no provider is mounted at call time —
 * same "read at construction, no retroactive mount" limitation `getViewUt()`
 * already has; a caller constructed before any provider mounts stays on its
 * fallback behaviour for its whole lifetime.
 */
export function onActiveTimelineFrame(cb: () => void): () => void {
  if (!activeTimelineStore) return () => {};
  return activeTimelineStore.subscribeFrame(cb);
}

/**
 * Reads the carried-channels allowlist supplied by the nearest
 * `TelemetryProvider` (see `./carried-channels.ts`) — throws if no
 * provider is in the tree, matching `useTelemetryStore`'s contract. Ordinary
 * SDK-native call sites needing to know "is this topic actually live right
 * now" should combine this with `isTopicCarried` rather than reading the raw
 * set directly.
 */
export function useCarriedChannels(): ReadonlySet<string> {
  const carriedChannels = useContext(CarriedChannelsContext);
  if (!carriedChannels) {
    throw new Error(
      "useCarriedChannels must be used within a TelemetryProvider",
    );
  }
  return carriedChannels;
}

/**
 * Non-throwing variant of `useCarriedChannels` — `undefined` when no
 * `TelemetryProvider` is mounted. Same rationale as
 * `useTelemetryClientOptional`/`useTelemetryStoreOptional`: the
 * `@ksp-gonogo/core` `useDataValue` compatibility shim needs this without
 * throwing, to decide whether it can route a mapped topic through the
 * stream pipeline at all.
 */
export function useCarriedChannelsOptional(): ReadonlySet<string> | undefined {
  return useContext(CarriedChannelsContext);
}
