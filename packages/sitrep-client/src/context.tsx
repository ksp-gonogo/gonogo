import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useMemo,
} from "react";
import type { TelemetryClient } from "./client";
import { TimelineStore } from "./timeline-store";
import { vesselStateChannel } from "./vessel-state";
import { ViewClock, type ViewClockOptions } from "./view-clock";

const TelemetryClientContext = createContext<TelemetryClient | undefined>(
  undefined,
);
const TimelineStoreContext = createContext<TimelineStore | undefined>(
  undefined,
);

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
 * - `client.subscribeStore(() => store.beginFrame())` mints a fresh
 *   `FrameToken` on every ingest tick (mirrors the doc on
 *   `TimelineStore.beginFrame`: "call once per animation frame / read
 *   cycle" — here that cycle is "a new sample arrived"), which is what makes
 *   `useStream`/`useStreamStatus`/`useCertainty`'s `useSyncExternalStore`
 *   subscriptions (keyed off `store.subscribeFrame`) actually re-render.
 *
 * `useStream`/the `@gonogo/core` `useDataValue` shim both read through
 * `store.sample(topic, store.currentFrame())` now (never `client.getValue`
 * directly) so raw AND derived topics resolve through the exact same
 * surface — see `use-stream.ts`.
 */
export function TelemetryProvider({
  client,
  children,
  store: providedStore,
  viewClockOptions,
}: TelemetryProviderProps) {
  // biome-ignore lint/correctness/useExhaustiveDependencies: viewClockOptions is deliberately read only ONCE, at construction of a store this provider owns — a caller passing a fresh inline options object every render must not tear down and rebuild the store/clock each time. `client` is correctly omitted: the store isn't tied to a specific client instance (the effects below wire whichever client is current to whichever store is current), only to `providedStore`'s identity.
  const store = useMemo(() => {
    if (providedStore) return providedStore;
    const built = new TimelineStore(new ViewClock(viewClockOptions));
    for (const channel of PRODUCTION_DERIVED_CHANNELS) {
      built.registerDerivedChannel(channel);
    }
    return built;
  }, [providedStore]);

  useEffect(() => client.attachStore(store), [client, store]);
  useEffect(
    () => client.subscribeStore(() => store.beginFrame()),
    [client, store],
  );

  return (
    <TelemetryClientContext.Provider value={client}>
      <TimelineStoreContext.Provider value={store}>
        {children}
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
const PRODUCTION_DERIVED_CHANNELS = [vesselStateChannel];

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
 * Exists for compatibility shims (`@gonogo/core`'s `useDataValue` →
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
 * `useTelemetryClientOptional`: the `@gonogo/core` `useDataValue`
 * compatibility shim needs both the client AND the store, without throwing,
 * to decide whether it can route a call through the new stream pipeline.
 */
export function useTelemetryStoreOptional(): TimelineStore | undefined {
  return useContext(TimelineStoreContext);
}
