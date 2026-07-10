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
import { systemStateChannel } from "./system-state";
import type { DerivedChannelDefinition } from "./timeline-store";
import { TimelineStore } from "./timeline-store";
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
 * behind `TelemetryProvider`'s carried-channels allowlist (M3 Wave 0,
 * `m3-migration-plan.md` §Build 1: "adding a topic can only move it from
 * legacy->stream, never blank a widget"). Never used to shrink: a caller
 * whose next render passes a SMALLER explicit `carriedChannels` prop (or
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
 * race to make a test flaky). M2 finalization Fix 1: the coalescing primitive
 * behind `TelemetryProvider`'s ingest -> `beginFrame()` scheduling below.
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
   * Explicit per-topic promotion list (M3 Wave 0 carried-channels gate,
   * `m3-migration-plan.md` §5.1/§Build 1, `./carried-channels.ts`) — the
   * "dev-first per-topic opt-in" half of the allowlist, alongside
   * `client.declaredChannels` (the transport's own served-channel
   * declaration). Union of the two is what `useDataValue`'s shim
   * (`@ksp-gonogo/core`) consults before ever routing a MAPPED topic to the
   * stream instead of legacy. Monotonic: a topic named here (or ever
   * declared by the transport) stays carried for the life of this mounted
   * provider even if a later render omits it — see `unionGrow`. Omit
   * entirely to carry only whatever the transport itself declares.
   */
  carriedChannels?: Iterable<string>;
}

/**
 * Supplies a `TelemetryClient` — and, since the M2 bridge task, a
 * `TimelineStore` fed from that client's wire — to the component tree via
 * context.
 *
 * **The bridge (M2 bridge task, Fix 1):** before this task, nothing in
 * production ever constructed a `TimelineStore` or registered a derived
 * channel on one, so `vessel.state.*` (and any future derived channel) was
 * permanently unreachable through `useStream`/`useDataValue` even once a
 * provider was mounted — the derivation machinery in `vessel-state.ts`/
 * `timeline-store.ts` existed but was wired to nothing. This provider is
 * what closes that gap:
 *
 * - Unless `store` is supplied, it builds ONE `TimelineStore` (backed by a
 *   `ViewClock`) per `client` and registers the production derived channels
 *   (`vesselStateChannel` today; extend `PRODUCTION_DERIVED_CHANNELS` below
 *   as more land) on it.
 * - `client.attachStore(store)` feeds every incoming `stream-data` wire
 *   frame into the store's per-topic timelines.
 * - `client.subscribeStore(...)` schedules a `store.beginFrame()` (M2
 *   finalization Fix 1) via `scheduleFrame` — a `requestAnimationFrame`
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
  // biome-ignore lint/correctness/useExhaustiveDependencies: viewClockOptions is deliberately read only ONCE, at construction of a store this provider owns — a caller passing a fresh inline options object every render must not tear down and rebuild the store/clock each time. `client` IS a dependency (M2 finalization Fix 2) for the auto-built branch below — see that branch's own comment for why; it's listed here (rather than split into two memos) so a `providedStore` caller's `client` swap still re-triggers the (no-op, `providedStore`-returning) factory, keeping this one memo the single source of truth `store` identity is derived from.
  const { store, delayAuthority } = useMemo(() => {
    if (providedStore) return { store: providedStore, delayAuthority: null };
    // Auto-built store must rebuild on `client` identity change (M2
    // finalization Fix 2, bridge review Important #1): before this fix,
    // `client` was deliberately omitted from this memo's deps (the comment
    // above used to argue the store "isn't tied to a specific client
    // instance") — but an AUTO-BUILT store has no owner other than this
    // provider, so a reconnect/client-swap that hands in a fresh
    // `TelemetryClient` left the old store (with its topics/timelines still
    // keyed off the old client's wire) permanently attached instead of
    // resetting, unlike pre-bridge behavior. A caller-`providedStore` is
    // still exempt — that store is the caller's own, its lifetime is
    // deliberately independent of `client` (see the `attachStore`/
    // `subscribeStore` effects below, which still re-wire IT to a new
    // `client` without rebuilding it).
    // Streaming-delay spec §7.3 Step 4 — the SINGLE delay-wiring point. The
    // auto-built clock's `delaySeconds` reads the `DelayAuthority` (fed from
    // `comms.delay` by the effect below) instead of the `() => 0` stub, so
    // the certainty horizon / predicted-present lead is sized to the real
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

  // The carried-channels allowlist (M3 Wave 0, `./carried-channels.ts`):
  // seeded from `client.declaredChannels` (the transport's own served-topic
  // declaration) unioned with the explicit `carriedChannels` promotion-list
  // prop. Persists and only ever GROWS across renders of this same provider
  // INSTANCE (`unionGrow` — the one-way ratchet `m3-migration-plan.md`
  // §Build 1 calls for: "monotonic... adding a topic can only move it from
  // legacy->stream, never blank a widget"), even if a later render's
  // `carriedChannelsProp` shrinks. Only resets on a genuine `client` identity
  // change (`carriedClientRef` tracks which client the current set belongs
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
  // Streaming-delay spec §7.3 Step 4: keep the auto-built clock's delay value
  // current by subscribing the `DelayAuthority` to `comms.delay`. Skipped when
  // the caller supplied their own `store` (they own its clock's delay wiring),
  // matching the auto-built store's client-identity lifetime above.
  useEffect(() => {
    if (!delayAuthority) return;
    return delayAuthority.attach(client);
  }, [client, delayAuthority]);
  useEffect(() => {
    // M2 finalization Fix 1: coalesce to (at most) one `beginFrame()` per
    // animation-frame tick, instead of one per `stream-data` message — see
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
 * Derived channels every `TelemetryProvider`-built default store registers
 * (M2 bridge task). A caller that needs a channel NOT in this list yet (or
 * wants to omit one) supplies its own pre-built `store` prop instead of
 * relying on the default.
 */
const PRODUCTION_DERIVED_CHANNELS: DerivedChannelDefinition<unknown>[] = [
  vesselStateChannel as DerivedChannelDefinition<unknown>,
  systemStateChannel as DerivedChannelDefinition<unknown>,
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
 * `useStream` migration, M2 Task 7) that must keep working — falling back to
 * a legacy code path — during the migration window before every screen
 * mounts a `TelemetryProvider`. Ordinary SDK-native call sites should keep
 * using `useTelemetryClient` so a missing provider fails loudly.
 */
export function useTelemetryClientOptional(): TelemetryClient | undefined {
  return useContext(TelemetryClientContext);
}

/**
 * Reads the `TimelineStore` supplied by the nearest `TelemetryProvider` (M2
 * bridge task). Always mounted alongside the client by `TelemetryProvider`
 * (auto-built if the `store` prop was omitted) — throws if no provider is in
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
 * authority (M2 design §1.2). Every surface that must stay delay-consistent
 * with telemetry (staleness, predicted-view, and crucially the kerbcast media
 * `DelayedPlayoutBuffer`, M2 design §5) reads its release/certainty edge off
 * THIS clock instance, never a second one it constructs itself. A media frame
 * and a telemetry sample stamped the same UT therefore surface at the same
 * `confirmedEdgeUt()` crossing — the §0 common-mode property.
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
 * "read view-UT directly" surface widgets need after the R6 `t.universalTime`
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
 * Reads the carried-channels allowlist supplied by the nearest
 * `TelemetryProvider` (M3 Wave 0, `./carried-channels.ts`) — throws if no
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
