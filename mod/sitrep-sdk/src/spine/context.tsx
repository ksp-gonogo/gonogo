import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type {
  CareerContract,
  SystemBodies,
  VesselIdentity,
  VesselOrbit,
  VesselTarget,
  WarpState,
} from "../__generated__/contract";
import type { CommandErrorCode } from "../__generated__/error-codes";
import { COMMAND_REFUSED } from "../api/command-rejection";
import { noteRosterErrorCodes } from "../api/error-codes";
import { magnitudeOf } from "../magnitude";
import type { TopicReading } from "../reading";
import { topicReading } from "../reading";
import { isValue, value } from "../unit-system/value";
import type { Value } from "../value";
import {
  arrivalUtOf,
  arrivesTooLate,
  LATE_ARRIVAL_DETAIL,
  LATE_ARRIVAL_ERROR_CODE,
} from "./arrival-deadline";
import type { TelemetryClient } from "./client";
import {
  getContributedDerivedChannels,
  onContributedChannelsChange,
} from "./contributed-channels";
import { noteUndeclaredRead } from "./contribution-scope";
import { registerCoreReckoners } from "./core-reckoners";
import { DelayAuthority } from "./delay-authority";
import {
  dvCurrentStageResourceChannel,
  dvCurrentStageResourceMaxChannel,
} from "./dv-stage-resources";
import { commandDelayed } from "./map-command";
import { DYNAMIC_WHOLE_TOPIC_PREFIXES, resolveValueTopic } from "./map-topic";
import { type OrbitalSolve, solveSelfOrbit } from "./orbital-solve";
import { OwnCraftDelayGate } from "./own-craft-vantage";
import { processorRuntimeFor } from "./processorEvaluator";
import { StreamRecorder, type StreamRecorderOptions } from "./replay-recorder";
import { spaceCenterStateChannel } from "./space-center-state";
import { type ReadTopicResolver, subscribeTopicRead } from "./subscribe-read";
import { systemStateChannel } from "./system-state";
import type { DerivedChannelDefinition } from "./timeline-store";
import { TimelineStore } from "./timeline-store";
import { installUnownedTopicWarning } from "./unowned-warning";
import { systemUplinkHealthChannel } from "./uplink-health";
import { ViewClock, type ViewClockOptions } from "./view-clock";

const TelemetryClientContext = createContext<TelemetryClient | undefined>(
  undefined,
);
const TimelineStoreContext = createContext<TimelineStore | undefined>(
  undefined,
);

/**
 * Schedule `cb` to run on the next animation frame, falling back to a
 * microtask when `requestAnimationFrame` isn't available (SSR, or a bare
 * jsdom constructed without `pretendToBeVisual`).
 *
 * **Under vitest's jsdom environment `pretendToBeVisual` defaults to true, so
 * tests do get a real `requestAnimationFrame` and exercise the frame path, not
 * the microtask fallback.** Worth stating plainly: believing otherwise sends an
 * act-warning investigation into the microtask branch, and an act warning here
 * originates in test teardown ordering instead.
 *
 * The coalescing primitive behind `TelemetryProvider`'s ingest ->
 * `beginFrame()` scheduling below. Returns a cancel function.
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
   * extra derived channels registered, or non-default `ViewClock` options,
   * a scrub UI, a fixed replay delay) instead of the default one this
   * provider builds. When omitted, `TelemetryProvider` builds one itself,
   * see this component's own doc comment.
   */
  store?: TimelineStore;
  /** Only consulted when `store` is omitted, options for the default `ViewClock` this provider builds. */
  viewClockOptions?: ViewClockOptions;
}

/**
 * Supplies a {@link TelemetryClient} to the tree below it, and the store every
 * Topic is read from, fed by that client. Derived Topics are registered on the
 * store, so they read like any other. Useful for giving every widget below it a
 * stream of the vessel's telemetry to read. Used by the app's telemetry
 * provider, which mounts it over the connection to the game.
 *
 * Pass `store` to supply the store yourself; otherwise one is built per
 * `client`. Every message that arrives is applied, and readers re-render at
 * most once per animation frame.
 *
 * @category Stream fixture
 */
export function TelemetryProvider({
  client,
  children,
  store: providedStore,
  viewClockOptions,
}: TelemetryProviderProps) {
  // biome-ignore lint/correctness/useExhaustiveDependencies: viewClockOptions is deliberately read only ONCE, at construction of a store this provider owns, a caller passing a fresh inline options object every render must not tear down and rebuild the store/clock each time. `client` IS a dependency for the auto-built branch below; see that branch's own comment for why; it's listed here (rather than split into two memos) so a `providedStore` caller's `client` swap still re-triggers the (no-op, `providedStore`-returning) factory, keeping this one memo the single source of truth `store` identity is derived from.
  const { store, delayAuthority } = useMemo(() => {
    if (providedStore) return { store: providedStore, delayAuthority: null };
    // Auto-built store must rebuild on `client` identity change, so `client`
    // has to stay in this memo's deps. It looks droppable, on the theory that
    // the store "isn't tied to a specific client instance", but an AUTO-BUILT
    // store has no owner other than this provider: dropped, a reconnect or
    // client-swap that hands in a fresh `TelemetryClient` leaves the previous
    // store (topics and timelines still keyed off the previous client's wire)
    // permanently attached instead of resetting. A
    // caller-`providedStore` is still exempt, that store is the caller's
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
    // (e.g. a fixed replay delay) still wins, the authority is only the
    // default. Media (kerbcast) reads this same clock, so it aligns for free.
    const authority = new DelayAuthority();
    const built = new TimelineStore(
      new ViewClock({
        ...viewClockOptions,
        delaySeconds: viewClockOptions?.delaySeconds ?? authority.delaySeconds,
      }),
      // A topic under a dynamic namespace is one whole raw topic, never a `<domain.channel>.<field>` split.
      { dynamicWholeTopicPrefixes: DYNAMIC_WHOLE_TOPIC_PREFIXES },
    );
    for (const channel of PRODUCTION_DERIVED_CHANNELS) {
      built.registerDerivedChannel(channel);
    }
    /*
     * Core's own forward models, through the same registry an Uplink's go
     * through. Idempotent, and re-asserted here rather than left to the module
     * side effect alone so a suite that cleared the registry between tests gets
     * the vanilla back with its store.
     */
    registerCoreReckoners();
    // Uplink-contributed channels register AFTER the first-party ones, so a
    // topic core already owns cannot be taken over by an Uplink importing
    // itself later. Contributions are per (topic, owner) and a contested topic
    // arrives from nobody: see `contributed-channels.ts`.
    for (const channel of getContributedDerivedChannels()) {
      built.registerDerivedChannel(channel);
    }
    return { store: built, delayAuthority: authority };
  }, [providedStore, client]);

  // A store is built with the channels contributed so far, which on a station
  // is none of them: its Uplink bundles cannot load until there is a
  // peer-backed client to read the roster off, so `StationScreen` mounts the
  // provider as the parent of the loader. Keep draining as contributions
  // arrive, skipping any topic the store already has so a channel never
  // changes meaning under a widget that is already reading it.
  useEffect(() => {
    const drain = () => {
      for (const channel of getContributedDerivedChannels()) {
        if (store.hasDerivedChannel(channel.topic)) continue;
        store.registerDerivedChannel(channel);
      }
    };
    drain();
    return onContributedChannelsChange(drain);
  }, [store]);

  useEffect(() => client.attachStore(store), [client, store]);
  // The author-facing half of the unowned mechanism. Mounted here because this
  // is where the client's lifetime is owned: one installation per client, so a
  // topic is warned about once however many widgets are reading it.
  useEffect(() => installUnownedTopicWarning(client), [client]);
  // Registers this provider's clock as the non-React `getViewUt()` accessor's
  // source: see `activeViewClock`'s doc comment above. Also registers the
  // store itself as `getVesselOrbit()`/`getVesselTarget()`/
  // `getVesselIdentity()`'s source: see
  // `activeTimelineStore`'s doc comment.
  useEffect(() => {
    mountedStores.push(store);
    activeViewClock = store.clock;
    setActiveTimelineStore(store);
    return () => {
      removeLast(mountedStores, store);
      const beneath = mountedStores.at(-1);
      if (activeViewClock === store.clock) activeViewClock = beneath?.clock;
      if (activeTimelineStore === store) setActiveTimelineStore(beneath);
    };
  }, [store]);
  // A Processor's raw Topic deps must be SUBSCRIBED to stream, not just sampled, so this store's Processor runtime subscribes them through this provider's client.
  useEffect(
    () =>
      processorRuntimeFor(store).setTopicSubscriber((topic) =>
        client.subscribe(topic, () => {}),
      ),
    [client, store],
  );
  // The same seam for a reckoner's PER-SUBJECT dep, and it has to be here for
  // the same reason: the subject is not known when a read subscribes, so
  // `subscribeTopicRead`'s set cannot contain a per-craft Topic and only the
  // store, which resolved the subject, can hold it up. Without this wiring the
  // model names an input nothing asked the wire for and declines on it for
  // ever.
  useEffect(() => {
    store.setDynamicSubscriber((topic) => client.subscribe(topic, () => {}));
    return () => store.setDynamicSubscriber(undefined);
  }, [client, store]);
  // Registers the client itself as `getActiveTelemetryClient()`'s source,
  // the plain-class (non-hook) command-dispatch equivalent of
  // `useTelemetryClientOptional()`, same rationale as `activeViewClock`/
  // `activeTimelineStore` above. Notifies `activeTelemetryClientListeners`
  // on both mount and unmount so `useActiveTelemetryClient()` (the reactive
  // counterpart used by call sites that render BEFORE a provider mounts,
  // e.g. a modal opened during the app's connect-in-progress window) picks
  // up the change instead of staying stuck on whatever it read at its own
  // first render.
  useEffect(() => {
    mountedClients.push(client);
    activeTelemetryClient = client;
    notifyActiveTelemetryClientListeners();
    syncTopicHolds();
    return () => {
      removeLast(mountedClients, client);
      if (activeTelemetryClient === client)
        activeTelemetryClient = mountedClients.at(-1);
      notifyActiveTelemetryClientListeners();
      syncTopicHolds();
    };
  }, [client]);
  // Keep the auto-built clock's delay value current by subscribing the
  // `DelayAuthority` to `comms.delay`. Skipped when
  // the caller supplied their own `store` (they own its clock's delay wiring),
  // matching the auto-built store's client-identity lifetime above.
  useEffect(() => {
    if (!delayAuthority) return;
    const detach = delayAuthority.attach(client);
    // The SAME authority also sizes command loss inference, so a dispatch nothing
    // answers settles instead of hanging. One wiring point, one number: the client
    // does not compute delay and the transport is not asked about it.
    const clearDelaySource = client.setDelaySource(delayAuthority.delaySeconds);
    return () => {
      clearDelaySource();
      detach();
    };
  }, [client, delayAuthority]);
  /*
   * The store decides every declared topic's lane from the roles block on
   * `system.uplinks`, so the roster is held for the provider's life rather than
   * only while something happens to be drawing Uplink health. The same roster
   * lists every Uplink's refusal refinements, which is how a refusal from an
   * Uplink whose bundle never loaded still reads as a sentence.
   */
  useEffect(
    () => client.subscribe("system.uplinks", noteRosterErrorCodes),
    [client],
  );
  /*
   * Staleness is inferred from keyframe cadence, and under warp the mod floors
   * that cadence in real time: the gap a client must allow is published on
   * `time.warp`. Held for the provider's life so a dashboard that draws no warp
   * readout still judges every other channel's staleness against it.
   */
  useEffect(() => client.subscribe("time.warp", () => {}), [client]);
  useEffect(() => {
    // Coalesce to (at most) one `beginFrame()` per animation-frame tick,
    // instead of one per `stream-data` message: see
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
    // A frame also has to arrive when NOTHING does. Ingest alone was the frame
    // source, and a quiet link mints no frames, so every quantity that is a
    // function of the frame's view time froze exactly when it mattered: a
    // reckoning stopped advancing at the instant the last packet landed while
    // the age rendered beside it kept climbing off `useViewUt`'s own rAF tick,
    // and a model's horizon could never fire because withdrawing needs a frame
    // to withdraw on.
    //
    // `onFrame` is the animation-frame tick, which is the cadence
    // `beginFrame`'s own doc asks for; coalescing to ingest was an optimisation
    // that happened to be wrong for silence. It routes through the SAME
    // `scheduled` gate, so an ingest and a tick in one animation frame still
    // mint one frame between them, and the ingest path is untouched.
    const unsubscribeClock = store.clock.onFrame(scheduleBeginFrame);
    return () => {
      unsubscribe();
      unsubscribeClock();
      cancelScheduled?.();
    };
  }, [client, store]);

  return (
    <TelemetryClientContext.Provider value={client}>
      <TimelineStoreContext.Provider value={store}>
        {delayAuthority ? (
          <OwnCraftDelayGate authority={delayAuthority} />
        ) : null}
        {children}
      </TimelineStoreContext.Provider>
    </TelemetryClientContext.Provider>
  );
}

/**
 * The first-party derived channels registered on the default store a
 * `TelemetryProvider` builds. A caller that needs a channel missing from this
 * list, or wants to omit one, passes its own pre-built `store` prop.
 *
 * An Uplink adds a derived channel with
 * `defineUplinkClient(...).registerDerivedChannel` and never by editing this
 * list: its channel is registered alongside these when the store is built. A
 * derived channel is the only way to join two Topics.
 */
export const PRODUCTION_DERIVED_CHANNELS: DerivedChannelDefinition<unknown>[] =
  [
    systemStateChannel as DerivedChannelDefinition<unknown>,
    systemUplinkHealthChannel as DerivedChannelDefinition<unknown>,
    spaceCenterStateChannel as DerivedChannelDefinition<unknown>,
    dvCurrentStageResourceChannel as DerivedChannelDefinition<unknown>,
    dvCurrentStageResourceMaxChannel as DerivedChannelDefinition<unknown>,
  ];

/**
 * The `TelemetryClient` supplied by the nearest `TelemetryProvider`, the
 * connection to the game that telemetry and commands travel over. Useful for
 * code that has to subscribe or send a command itself. Throws when no
 * `TelemetryProvider` is mounted.
 */
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
 * The `TelemetryClient` supplied by the nearest `TelemetryProvider`, or
 * `undefined` when none is mounted. Useful for showing the operator a panel
 * that has to render whether or not a stream exists, such as a station screen
 * before its provider is up. Used by the hooks that follow the observed
 * vantage and the currency events.
 *
 * A caller that needs the stream uses `useTelemetryClient`, which throws when
 * no provider is mounted.
 */
export function useTelemetryClientOptional(): TelemetryClient | undefined {
  return useContext(TelemetryClientContext);
}

/**
 * A `StreamRecorder` bound to the nearest `TelemetryProvider`'s client, kept
 * across renders, or `undefined` when no provider is mounted. Useful for
 * recording a flight's telemetry so the operator can replay it. Used by the
 * controller that records flights automatically.
 *
 * The recorder registers no listener on the client until its own `start()` is
 * called, so a caller that never starts it adds no wire subscription and no
 * message tap.
 *
 * `recordAllTopics` is read once, when the recorder is built. To change it,
 * call `stop()` on any recording in progress; the next render builds a fresh
 * recorder with the new option.
 */
export function useStreamRecorder(
  options?: StreamRecorderOptions,
): StreamRecorder | undefined {
  // gonogo:reads none
  const client = useTelemetryClientOptional();
  const recordAllTopics = options?.recordAllTopics ?? false;
  return useMemo(
    () =>
      client ? new StreamRecorder(client, { recordAllTopics }) : undefined,
    [client, recordAllTopics],
  );
}

/**
 * The `TimelineStore` supplied by the nearest `TelemetryProvider`, the record
 * of every Topic's samples that telemetry is read from. Useful for code that
 * has to sample or subscribe to the store itself. `TelemetryProvider` always
 * mounts one with the client, building it when the `store` prop is omitted.
 * Throws when no provider is mounted.
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
 * The `TimelineStore` supplied by the nearest `TelemetryProvider`, or
 * `undefined` when none is mounted. Useful for a panel that has to render
 * whether or not a stream exists and that shows what the stream is carrying.
 * Used by the hook that reads the game status.
 *
 * A caller that needs the store uses `useTelemetryStore`, which throws when no
 * provider is mounted.
 */
export function useTelemetryStoreOptional(): TimelineStore | undefined {
  return useContext(TimelineStoreContext);
}

/**
 * The nearest `TelemetryProvider`'s **one** `ViewClock`: the single delay
 * authority. Every surface that must stay delay-consistent with telemetry
 * (staleness, reckoning to SCET, and crucially the kerbcast media
 * `DelayedPlayoutBuffer`) reads its release/certainty edge off
 * this clock instance, never a second one it constructs itself. A media frame
 * and a telemetry sample stamped the same UT therefore surface at the same
 * `confirmedEdgeUt()` crossing: a shared common-mode property.
 *
 * The returned `ViewClock` is structurally the `DelayClockLike` surface
 * (`confirmedEdgeUt` + `onFrame`) the media buffer depends on, so it can be
 * handed straight to `DelayedPlayoutBuffer`: kerbcast
 * stays decoupled (it imports no sitrep-client type; the app passes this in).
 *
 * Throws if no `TelemetryProvider` is mounted, matching `useTelemetryStore`.
 */
/**
 * The read-only slice of `ViewClock` that delay-consistent consumers actually
 * need: the `viewUt` view time, the `confirmedEdgeUt` release/certainty edge,
 * and the `onFrame` subscription. Narrowing the hook return to this `Pick`
 * keeps consumers (the kerbcast `DelayedPlayoutBuffer` seam, camera widgets)
 * from reaching for the clock's mutating surface, they observe, they never
 * drive it.
 *
 * `viewUt` is an observation, not a driver (the scrub/mode setters are what
 * "drive" the clock, and those stay out of this Pick), it belongs here for the
 * same reason `activeViewClock` below is deliberately typed on it: it is the
 * quantity `onFrame` hands its callback, and the only one that honours a scrub
 * target, so anything mirroring `useViewUt`'s contract has to read it rather
 * than `confirmedEdgeUt`.
 *
 * `utNowEstimate` is an observation on the same footing, and it is here for a
 * consumer `confirmedEdgeUt` cannot serve: a human message carries a send UT
 * minted at the sender's present, so the recipient reveals it against their own
 * present rather than their delayed certainty horizon. Gating that on
 * `confirmedEdgeUt` would hold it for `sentUt + 2 x delay`, a round trip for a
 * one-way utterance. `useUtNow` reads the same quantity reactively; this is the
 * callable form a `DelayClockLike` adapter needs.
 */
/*
 * `delaySeconds` is on the view for the SCET/received distinction: it is the
 * gap between the two clocks this view exposes, so a surface that must say
 * which one an instant is on reads it here rather than re-deriving it from
 * `comms.delay`. A second derivation would have to re-implement
 * `DelayAuthority`'s hold-through-a-blackout rule, and would report a craft as
 * having come closer the moment it became unreachable.
 */
export type ViewClockView = Pick<
  ViewClock,
  | "viewUt"
  | "scetUt"
  | "commandArrivalUt"
  | "confirmedEdgeUt"
  | "onFrame"
  | "utNowEstimate"
  | "delaySeconds"
>;

/**
 * The most recently mounted `TelemetryProvider`'s clock, tracked outside
 * React for non-hook callers (plain classes: trigger/alarm services, that
 * can't call `useViewUt`). Set/cleared by the registration effect in
 * `TelemetryProvider` below. Several can be mounted at once (a modal's bridge,
 * a replay session, a docs page), so an unmount hands it back to the most
 * recent provider still mounted rather than clearing it.
 *
 * Deliberately typed as `Pick<ViewClock, "viewUt">`, not the narrower
 * `ViewClockView` (`confirmedEdgeUt` + `onFrame`) `useViewClockOptional`
 * returns: `useViewUt`'s reactive value tracks `onFrame`'s per-frame
 * `viewUt()` callback argument, not `confirmedEdgeUt()` directly (the two
 * diverge whenever a scrub target is set, `viewUt()` honours it outright,
 * `confirmedEdgeUt()` never does, per that method's own doc comment), so
 * `getViewUt()` below must read the exact same method to match `useViewUt`'s
 * contract, including under a pinned/scrubbed test clock.
 */
let activeViewClock:
  | Pick<ViewClock, "viewUt" | "scetUt" | "commandArrivalUt">
  | undefined;

/**
 * What each mounted provider registered, most recent last, so an unmount hands
 * every active accessor back to the provider beneath it. Arrays, not sets: two
 * providers can share one client or one store.
 */
const mountedStores: TimelineStore[] = [];
const mountedClients: TelemetryClient[] = [];

function removeLast<Item>(stack: Item[], item: Item): void {
  const index = stack.lastIndexOf(item);
  if (index >= 0) stack.splice(index, 1);
}

export function useViewClock(): ViewClockView {
  // gonogo:reads none
  return useTelemetryStore().clock;
}

/**
 * The shared view clock of the nearest `TelemetryProvider`, which says what UT
 * the frame on screen is drawn for, or `undefined` when none is mounted. Useful
 * for a widget such as a camera feed that delays its playout by the one-way
 * delay when a stream is live and plays straight through otherwise. Used by the
 * hook that reads the time contexts.
 *
 * A caller that requires the clock uses `useViewClock`.
 */
export function useViewClockOptional(): ViewClockView | undefined {
  // gonogo:reads none
  return useTelemetryStoreOptional()?.clock;
}

/**
 * The current view time in UT seconds, as a reactive value: the instant the
 * frame on screen is drawn for, which follows a scrub. Useful for a widget
 * that counts down against telemetry, so the countdown is timed by the same
 * clock as the data. `undefined` when no `TelemetryProvider` is mounted or
 * before the first confirmed sample, so a widget can fall back with `??`.
 *
 * It re-renders its caller on every animation frame, the cadence the media
 * buffer runs on, which is what a live countdown needs. A caller that needs
 * the clock object and no reactive value uses `useViewClock`.
 */
export function useViewUt(): Value<"ut"> | undefined {
  return useFrameInstant(receivedEdge);
}

function receivedEdge(_clock: ViewClockView, viewUt: number): number {
  return viewUt;
}

/** One of the frame's instants, derived from the view time `onFrame` hands each tick, as a reactive `Value`. */
function useFrameInstant(
  instant: (clock: ViewClockView, viewUt: number) => number,
): Value<"ut"> | undefined {
  const clock = useViewClockOptional();
  // Seed from `viewUt()`: the SAME quantity `onFrame` hands the tick below,
  // not `confirmedEdgeUt()`. The two only agree on a free-running clock:
  // `viewUt()` returns `scrubTo`'s target outright when one is set (see its
  // own doc), whereas `confirmedEdgeUt()` ignores the scrub and keeps
  // tracking live. Seeding off the latter made a scrubbed clock render its
  // first frame at the live confirmed edge and snap to the scrub target only
  // one frame later: a flash of the wrong view time in a scrub UI, and a
  // guaranteed state transition on every mount.
  const [ut, setUt] = useState<number | undefined>(() => {
    const seed = clock && instant(clock, clock.viewUt());
    return seed !== undefined && Number.isFinite(seed) ? seed : undefined;
  });
  // `onFrame` notifies unconditionally at ~60Hz whether or not the view time
  // actually moved (a paused, scrubbed or between-samples clock reports the
  // same UT every frame). Dispatching the view-time update regardless leaned on
  // React's *eager bailout* to swallow the no-op, an optimisation React only
  // applies while the fiber has no other pending work, so an unlucky frame
  // still schedules a full render pass for an unchanged value. Comparing here
  // means an unchanged frame costs no dispatch at all.
  const lastDelivered = useRef(ut);
  useEffect(() => {
    if (!clock) {
      lastDelivered.current = undefined;
      setUt(undefined);
      return;
    }
    return clock.onFrame((viewUt) => {
      const at = instant(clock, viewUt);
      const next = Number.isFinite(at) ? at : undefined;
      if (next === lastDelivered.current) return;
      lastDelivered.current = next;
      setUt(next);
    });
  }, [clock, instant]);
  /*
   * Wrapped at the RETURN, not carried as a `Value` through the state above. The
   * frame bailout compares the incoming UT against the last delivered one, and two
   * `Value`s holding the same instant are different objects, so comparing them would
   * dispatch a render every frame and undo the thing that comment is about.
   *
   * Memoised for the same reason from the other side: an unchanged view time must
   * hand back an unchanged reference, or every `useMemo` downstream that depends on
   * it recomputes each frame.
   */
  return useMemo(() => (ut === undefined ? undefined : value("ut", ut)), [ut]);
}

/**
 * The current undelayed UT in seconds, as a reactive value:
 * `ViewClock.utNowEstimate()`, where `useViewUt` follows the delayed view
 * time. Used for values stamped in the command centre's own present, such as
 * the dispatch and prediction timestamps on `system.uplink.pending`. Timing
 * those against `useViewUt` shows them, and clears them, one one-way delay
 * late.
 *
 * `undefined` when no `TelemetryProvider` is mounted. It has a value from the
 * moment a clock exists (0, or the last observed sample UT), with no wait for
 * a first confirmed sample.
 */
export function useUtNow(): number | undefined {
  /*
   * Modeled directly on `useViewUt`: same `onFrame` subscription, same
   * seed-then-subscribe shape: except the per-frame callback recomputes
   * `clock.utNowEstimate()` itself rather than using the `viewUt` argument
   * `onFrame` hands it (that argument is `clock.viewUt()`, the delayed/
   * scrubbable value `useViewUt` wants: not what this hook needs).
   */
  // gonogo:reads none
  const store = useTelemetryStoreOptional();
  const clock = store?.clock;
  const [utNow, setUtNow] = useState<number | undefined>(() => {
    const seed = clock?.utNowEstimate();
    return seed !== undefined && Number.isFinite(seed) ? seed : undefined;
  });
  // Same unchanged-frame guard as `useViewUt`: see its comment.
  const lastDelivered = useRef(utNow);
  useEffect(() => {
    if (!clock) {
      lastDelivered.current = undefined;
      setUtNow(undefined);
      return;
    }
    return clock.onFrame(() => {
      const estimate = clock.utNowEstimate();
      const next = Number.isFinite(estimate) ? estimate : undefined;
      if (next === lastDelivered.current) return;
      lastDelivered.current = next;
      setUtNow(next);
    });
  }, [clock]);
  return utNow;
}

/**
 * The current view time in UT seconds, read on demand by a caller that cannot
 * use hooks. Useful for a service that must judge times against the instant the
 * frame on screen is drawn for. Used by the alarm host service.
 *
 * It reads the clock of the `TelemetryProvider` that mounted most recently, so
 * it follows the same delayed, scrub-respecting clock as `useViewUt`.
 * `undefined` when no provider has ever mounted or before any live or scrubbed
 * value is available.
 */
export function getViewUt(): Value<"ut"> | undefined {
  noteUndeclaredRead("getViewUt");
  const ut = activeViewClock?.viewUt();
  return ut !== undefined && Number.isFinite(ut) ? value("ut", ut) : undefined;
}

/**
 * Makes `clock` the source of `getViewUt()` and the clock that
 * `dispatchActiveCommandTopic` judges arrival by, without mounting a
 * `TelemetryProvider`. Useful for a test of a service that has no React tree.
 *
 * A fake with no `scetUt` answers SCET as its view time, and one with no
 * `commandArrivalUt` answers arrival as its SCET, which is what a clock with no
 * signal delay does. Pass `undefined` to clear it, and do so in the test's
 * `afterEach` so a later test cannot read a stale clock.
 */
export function setActiveViewClockForTests(
  clock:
    | (Pick<ViewClock, "viewUt"> &
        Partial<Pick<ViewClock, "scetUt" | "commandArrivalUt">>)
    | undefined,
): void {
  activeViewClock = clock && {
    viewUt: () => clock.viewUt(),
    scetUt: (viewUt) => clock.scetUt?.(viewUt) ?? viewUt,
    commandArrivalUt: (scetUt) => clock.commandArrivalUt?.(scetUt) ?? scetUt,
  };
}

/**
 * The most recently mounted `TelemetryProvider`'s `TimelineStore`, tracked
 * outside React for the same non-hook callers `activeViewClock` serves,
 * plain classes (`LocalManeuverTriggerService`, the maneuver-trigger and
 * alarm host services) that need a point-in-time read of a fixed Topic
 * (`vessel.orbit`, `vessel.target`, `vessel.identity`) without subscribing. Narrowed to the methods an on-demand
 * sample needs, matching `activeViewClock`'s narrowing to just `viewUt`.
 * `sampleReading` is among them because the orbital solve is gated on a model
 * and a payload carries none. Set/cleared by the same registration effect in
 * `TelemetryProvider` above.
 */
type ActiveTimelineStore = Pick<
  TimelineStore,
  "sample" | "sampleReading" | "currentFrame" | "subscribeFrame"
>;

let activeTimelineStore: ActiveTimelineStore | undefined;

/**
 * Every `onActiveTimelineFrame` caller, held independently of whichever store
 * is currently active so that a caller's subscription outlives a provider
 * mount and does not depend on one existing when it subscribes.
 */
const timelineFrameListeners = new Set<() => void>();

/**
 * The single `subscribeFrame` registration standing in for all of
 * `timelineFrameListeners`, and the store it is against, so that a store
 * arriving, swapping or going away moves every listener with it.
 */
let timelineFrameBridge: (() => void) | undefined;
let bridgedTimelineStore:
  | Pick<TimelineStore, "sample" | "currentFrame" | "subscribeFrame">
  | undefined;

/**
 * Points the bridge at the active store, or tears it down when there is no
 * store or nothing listening. Called on both edges: a listener arriving or
 * leaving, and the active store changing.
 */
function syncTimelineFrameBridge(): void {
  const target =
    timelineFrameListeners.size > 0 ? activeTimelineStore : undefined;
  if (target === bridgedTimelineStore) return;
  timelineFrameBridge?.();
  timelineFrameBridge = undefined;
  bridgedTimelineStore = target;
  if (!target) return;
  timelineFrameBridge = target.subscribeFrame(() => {
    // Copied: a listener is free to unsubscribe itself from inside the callback, which would otherwise mutate the set mid-iteration.
    for (const listener of [...timelineFrameListeners]) listener();
  });
}

/**
 * The active store's topic resolution, which `holdActiveTopicRead` needs and
 * an on-demand sample does not. Undefined for a test double that does not
 * implement it, so a hold simply waits rather than subscribing wrongly.
 */
let activeReadResolver: ReadTopicResolver | undefined;

/**
 * The one way `activeTimelineStore` changes, so that the frame bridge and the
 * topic holds are never left pointing at a store that is no longer the active
 * one.
 */
function setActiveTimelineStore(
  store: (ActiveTimelineStore & Partial<ReadTopicResolver>) | undefined,
): void {
  activeTimelineStore = store;
  activeReadResolver =
    typeof store?.resolveSubscriptionTopics === "function" &&
    typeof store.reckonerDepTopics === "function"
      ? (store as ReadTopicResolver)
      : undefined;
  syncTimelineFrameBridge();
  syncTopicHolds();
}

/**
 * Every hold `holdActiveTopicRead` has handed out and not yet released, by the
 * token only its own release function knows.
 */
const topicHolds = new Map<symbol, { topic: string; label?: string }>();

/** What each hold has subscribed against the pair below. */
const topicHoldReleases = new Map<symbol, () => void>();
let heldClient: TelemetryClient | undefined;
let heldResolver: ReadTopicResolver | undefined;

/**
 * Points every hold at the active client and store, moving all of them when
 * either changes and dropping them while either is missing.
 */
function syncTopicHolds(): void {
  if (
    activeTelemetryClient !== heldClient ||
    activeReadResolver !== heldResolver
  ) {
    for (const release of topicHoldReleases.values()) release();
    topicHoldReleases.clear();
    heldClient = activeTelemetryClient;
    heldResolver = activeReadResolver;
  }
  if (!heldClient || !heldResolver) return;
  for (const [token, hold] of topicHolds) {
    if (topicHoldReleases.has(token)) continue;
    topicHoldReleases.set(
      token,
      subscribeTopicRead(heldClient, heldResolver, hold.topic, hold.label),
    );
  }
}

/**
 * The most recently mounted `TelemetryProvider`'s `TelemetryClient`, tracked
 * outside React for the same non-hook callers `activeViewClock`/
 * `activeTimelineStore` serve: the plain-class equivalent of
 * `useTelemetryClientOptional()`. This is what lets a plain class
 * (`GoNoGoHostService`) dispatch a command through the stream
 * (`dispatchActiveCommand`) exactly as `useCommand` does for a widget.
 */
let activeTelemetryClient: TelemetryClient | undefined;

/**
 * Listeners notified whenever `activeTelemetryClient` changes (a
 * `TelemetryProvider` mounts, unmounts, or swaps its `client` prop). Backs
 * `subscribeActiveTelemetryClient`/`useActiveTelemetryClient`: the reactive
 * counterpart to the plain `getActiveTelemetryClient()` read, for a call
 * site that renders before any provider is mounted (e.g. a modal opened
 * during the app's connect-in-progress window) and needs to pick up the
 * client the moment it appears rather than staying stuck on the `undefined`
 * it captured at its own first render.
 */
const activeTelemetryClientListeners = new Set<() => void>();

function notifyActiveTelemetryClientListeners(): void {
  for (const listener of activeTelemetryClientListeners) listener();
}

/**
 * The latest payload of `topic`, read on demand by a caller that cannot use
 * hooks, from the `TelemetryProvider` that mounted most recently. It is the
 * value a widget's `useTelemetry(topic)` would show on the same frame. Useful
 * for a service that needs a Topic chosen at call time. Used by the alarm host
 * service.
 *
 * `undefined` when no provider has ever mounted or before any sample has
 * arrived for `topic`. It does not subscribe to `topic` on the wire, so some
 * other live subscriber, typically a mounted widget reading the same Topic, has
 * to keep the data flowing.
 *
 * The payload is a display value held from the last sample: it cannot say how
 * old it is or whether anything still feeds the Topic. A caller that acts on
 * the answer rather than draws it uses {@link sampleActiveReading}.
 */
export function sampleActiveTopic<Payload>(topic: string): Payload | undefined {
  noteUndeclaredRead("sampleActiveTopic", topic);
  if (!activeTimelineStore) return undefined;
  const point = activeTimelineStore.sample<Payload>(
    topic,
    activeTimelineStore.currentFrame(),
  );
  return point ? (point.payload as Payload | undefined) : undefined;
}

/**
 * One shared `pending` for the no-provider answer, so repeated calls hand back
 * one object rather than a fresh one each time.
 */
const NO_PROVIDER_READING = topicReading<never>({
  state: "pending",
  reckoning: { status: "none" },
});

/**
 * The whole `TopicReading` of `topic`, read on demand by a caller that cannot
 * use hooks, from the `TelemetryProvider` that mounted most recently. It is the
 * reading a widget's `useTelemetry(topic)` would get on the same frame, with
 * how current it is, where `sampleActiveTopic` returns the bare payload. Useful
 * for a service that acts on telemetry on the operator's behalf. Used by the
 * alarm host service.
 *
 * A caller acting on a reading branches on `state` and treats `held` as a
 * reason to stop. A bare payload is held from the last sample for as long as the
 * epoch stands, even after the last subscriber of the Topic has gone, so it
 * cannot show that nothing is feeding it.
 *
 * Answers `pending` when no provider has ever mounted, as `useTelemetry` does
 * outside a provider.
 */
export function sampleActiveReading<Payload>(
  topic: string,
): TopicReading<Payload> {
  if (!activeTimelineStore) return NO_PROVIDER_READING as TopicReading<Payload>;
  return activeTimelineStore.sampleReading<Payload>(
    topic,
    activeTimelineStore.currentFrame(),
  );
}

/**
 * The vessel's own Keplerian orbit elements (`sma`, `ecc`, `inc`, `lan`,
 * `argPe`, `mu` and the rest) from `vessel.orbit`, as a single read for a caller
 * that cannot use hooks. Useful for a service that plans against the orbit the
 * operator is flying. Used by the maneuver-trigger host service.
 */
export function getVesselOrbit(): VesselOrbit | undefined {
  return sampleActiveTopic<VesselOrbit>("vessel.orbit");
}

/**
 * The vessel's current target from `vessel.target`: its identity, relative
 * kinematics and, when it has one, its orbit. A single read for a caller that
 * cannot use hooks. Useful for a service that acts on the target the operator
 * has picked. Used by the maneuver-trigger host service.
 */
export function getVesselTarget(): VesselTarget | undefined {
  return sampleActiveTopic<VesselTarget>("vessel.target");
}

/**
 * The vessel's name, type, situation and parent body index from
 * `vessel.identity`, as a single read for a caller that cannot use hooks.
 * Useful for a service that names the vessel to the operator. Used by the SCET
 * alarm bridge and the go/no-go host service.
 */
export function getVesselIdentity(): VesselIdentity | undefined {
  return sampleActiveTopic<VesselIdentity>("vessel.identity");
}

/**
 * The body tree from `system.bodies`, keyed by stable body index, as a single
 * read for a caller that cannot use hooks. Useful for turning an orbital radius
 * into an altitude, which needs the reference body's own radius, and for naming
 * bodies to the operator. Used by the maneuver-trigger host service.
 */
export function getSystemBodies(): SystemBodies | undefined {
  return sampleActiveTopic<SystemBodies>("system.bodies");
}

/**
 * The vessel's apsides, their altitudes, the apsis countdowns, true anomaly,
 * period and orbital radius at the frame's view time, or `null` where the orbit
 * model has withdrawn. A single read for a caller that cannot use hooks. Useful
 * for a service that plans a maneuver against the orbit the operator sees. Used
 * by the maneuver-trigger host service.
 *
 * It samples the reading and applies the same withdrawal rule a hook would, so
 * a plan and the panel drawing the orbit agree on whether there is an orbit.
 * Without a mounted provider it returns `null`.
 */
export function getOrbitSolve(): OrbitalSolve | null {
  if (!activeTimelineStore) return null;
  const reading =
    activeTimelineStore.sampleReading<VesselOrbit>("vessel.orbit");
  /* Held carries its elements too: see `solveSelfOrbit` for why that is as
     good a starting point as an observed one, and for what decides whether
     they may be advanced. */
  const elements =
    reading.state === "observed" || reading.state === "held"
      ? reading.value
      : undefined;
  return solveSelfOrbit(
    elements,
    reading.reckoning,
    getSystemBodies(),
    getViewUt(),
    reading.state === "observed" ? reading.atUt : undefined,
  );
}

/**
 * The current magnitude of a field the operator picked, read on demand by a
 * caller that cannot use hooks. Useful for comparing a telemetry field against
 * a threshold set by the operator. Used by the maneuver-trigger host service.
 *
 * `key` is a field path or a dynamic-namespace key, resolved through
 * `resolveValueTopic`, and the resulting Topic is sampled from the active
 * `TimelineStore`. The answer is the number inside the `Value` a unit-carrying
 * field arrives as. It is `undefined` for a non-numeric field, a read not yet
 * arrived, and a key that does not resolve, such as a stored key that names a
 * retired subject. The caller that stored the key shows the operator that its
 * subject no longer resolves.
 */
export function getValue(key: string): number | undefined {
  const topic = resolveValueTopic(key);
  if (topic === undefined) return undefined;
  return pickedKeyMagnitude(sampleActiveTopic<unknown>(topic));
}

/**
 * The magnitude of a picked key's payload, in both shapes it can arrive in. A
 * field of a raw Topic carries its unit by the time it reaches the store,
 * because the decode wraps every declared quantity (`wrapTopicPayload`) and the
 * store's field-subtopic walk hands back whatever the parent record holds; a
 * field of a client-DERIVED channel is computed here and never met the wrap, so
 * it is a plain number. `magnitudeOf` owns the finite check for both, which is
 * the point of routing through it: a second spelling of "absent or non-finite"
 * beside it is how one of them came to answer NaN.
 */
function pickedKeyMagnitude(payload: unknown): number | undefined {
  const quantity =
    isValue(payload) || typeof payload === "number" ? payload : null;
  return magnitudeOf(quantity) ?? undefined;
}

/**
 * The whole `WarpState` record from `time.warp` (`warpRate`, `warpRateIndex`,
 * `warpMode` and `paused`), as a single read for a caller that cannot use hooks.
 * Useful for a service that reacts when the operator changes time warp. Used by
 * the warp observer.
 */
export function getWarpState(): WarpState | undefined {
  return sampleActiveTopic<WarpState>("time.warp");
}

/**
 * The contracts currently active in the career, from the `contracts.active`
 * field of `career.status`, as a single read for a caller that cannot use hooks.
 * Useful for a service that names the contracts the operator has accepted.
 */
export function getContractsActive(): CareerContract[] | undefined {
  return sampleActiveTopic<CareerContract[]>("career.status.contracts.active");
}

/**
 * The `TelemetryClient` of the `TelemetryProvider` that is mounted now, or
 * `undefined` when none is, for a caller that cannot use hooks. Useful for a
 * service that sends commands or subscribes to Topics outside React. Used by
 * the SCET alarm bridge and the peer host service.
 *
 * It reads once and never updates. A component that may render before a
 * provider mounts uses `useActiveTelemetryClient`.
 */
export function getActiveTelemetryClient(): TelemetryClient | undefined {
  return activeTelemetryClient;
}

/**
 * Calls `listener` whenever the mounted `TelemetryProvider`'s client changes,
 * and returns a function that stops it. Useful for a service outside React that
 * has to follow the stream's connection as it comes and goes. Used by the SCET
 * alarm bridge and by `useActiveTelemetryClient`.
 */
export function subscribeActiveTelemetryClient(
  listener: () => void,
): () => void {
  activeTelemetryClientListeners.add(listener);
  return () => {
    activeTelemetryClientListeners.delete(listener);
  };
}

/**
 * The `TelemetryClient` of the mounted `TelemetryProvider`, or `undefined` when
 * none is, re-rendering its caller whenever a provider mounts, unmounts or
 * swaps its client. Useful for a component that may render before a provider
 * mounts, such as a modal that opens while the connection to the game is still
 * being made. Used by the bridge that carries telemetry into modals.
 *
 * `getActiveTelemetryClient` reads once and never updates.
 */
export function useActiveTelemetryClient(): TelemetryClient | undefined {
  return useSyncExternalStore(
    subscribeActiveTelemetryClient,
    getActiveTelemetryClient,
  );
}

/**
 * The mod's refusal of a command that was routed: its code and message, as
 * the mod wrote them. Useful for telling the operator why a command did not take
 * effect. Used by `dispatchActiveCommandTopic`, which resolves `settled` with
 * it.
 *
 * The message can be the only place a fact is stated. Arming a SCET alarm on
 * a threshold whose Topic the simulation cannot resolve is refused with a
 * message naming that Topic, and an alarm armed without reading it never
 * fires.
 */
export interface DispatchCommandRefusal {
  code: string;
  message: string;
  /**
   * The mod's typed reason, when the refusal came from a command handler rather
   * than from the transport. Absent on a transport-level failure, which has no
   * contract code to carry.
   *
   * This is the field to branch on. `code` is the constant every refusal of
   * every command shares, so it distinguishes nothing, and the message is prose
   * that names the subject it refused.
   */
  errorCode?: CommandErrorCode;
  /** The refinement's id, when the refusal was more specific than `errorCode`. */
  reason?: string;
  /**
   * The mod's own words about this refusal, when it quoted the game. `message`
   * is synthesised from the code and names the command, so it reads the same
   * for every refusal of that command; this is the half that names the subject
   * the operator chose.
   */
  detail?: string;
}

/**
 * The result of {@link dispatchActiveCommandTopic}: whether the command was put
 * on the stream, and when it was, a promise of the simulation's refusal or
 * `undefined` once it succeeded. Useful for telling the operator at once that a
 * command did not go. Returned by `dispatchActiveCommandTopic`.
 */
export type DispatchActiveCommandResult =
  | { routed: true; settled: Promise<DispatchCommandRefusal | undefined> }
  | { routed: false };

/**
 * A dispatch rejection as its two readable halves, whatever threw it.
 *
 * Read structurally rather than by `instanceof CommandError`: the rejection can
 * cross a bundle boundary, and the class the value was minted from is not
 * necessarily the class this copy holds. `code` and `message` are own
 * properties on it for exactly this reason.
 */
function describeDispatchRejection(error: unknown): DispatchCommandRefusal {
  if (typeof error === "object" && error !== null) {
    const candidate = error as {
      code?: unknown;
      message?: unknown;
      errorCode?: unknown;
      reason?: unknown;
      detail?: unknown;
    };
    return {
      code: typeof candidate.code === "string" ? candidate.code : "",
      message:
        typeof candidate.message === "string"
          ? candidate.message
          : String(error),
      errorCode:
        typeof candidate.errorCode === "string"
          ? (candidate.errorCode as CommandErrorCode)
          : undefined,
      reason:
        typeof candidate.reason === "string" ? candidate.reason : undefined,
      detail:
        typeof candidate.detail === "string" ? candidate.detail : undefined,
    };
  }
  return { code: "", message: String(error) };
}

/**
 * Dispatches a command through the stream, for a plain-class caller with no
 * render tree to call {@link useCommand} from. Used by the host services that
 * send commands outside React, such as alarms and warp control.
 *
 * The routing decision is synchronous, so `routed` can be checked in the same
 * tick as the call. `routed: false` means only that no provider is mounted,
 * so there is no stream to put the command on.
 *
 * A routed command settles asynchronously, and `settled` never rejects. It
 * resolves with the simulation's refusal (its code and message as written)
 * when the command was refused, and with `undefined` when it succeeded.
 */
export function dispatchActiveCommandTopic(
  command: string,
  args: unknown,
): DispatchActiveCommandResult {
  const client = activeTelemetryClient;
  if (!client) return { routed: false };
  const clock = activeViewClock;
  const arrivalUt = clock
    ? arrivalUtOf(clock, commandDelayed(command))
    : undefined;
  if (arrivesTooLate(command, args, arrivalUt)) {
    return {
      routed: true,
      settled: Promise.resolve({
        code: COMMAND_REFUSED,
        message: `command ${JSON.stringify(command)} was not dispatched: ${LATE_ARRIVAL_DETAIL}`,
        errorCode: LATE_ARRIVAL_ERROR_CODE,
        detail: LATE_ARRIVAL_DETAIL,
      }),
    };
  }
  const { result } = client.dispatch(command, args);
  return {
    routed: true,
    settled: result.then(
      () => undefined,
      (error: unknown) => describeDispatchRejection(error),
    ),
  };
}

/**
 * Makes `store` the source of `getVesselOrbit()`, `getVesselTarget()`,
 * `getVesselIdentity()` and the other on-demand reads, without mounting a
 * `TelemetryProvider`. Useful for a test of a service that has no React tree.
 * Pass `undefined` to clear it, and do so in the test's `afterEach` so a later
 * test cannot read a stale store.
 */
export function setActiveTimelineStoreForTests(
  store: (ActiveTimelineStore & Partial<ReadTopicResolver>) | undefined,
): void {
  setActiveTimelineStore(store);
}

/**
 * Makes `client` the one commands are sent through, without mounting a {@link
 * TelemetryProvider}, for a test of code that sends commands outside React.
 * Pass `undefined` to clear it. Useful for testing the commands a widget sends
 * when the operator presses a control outside React's own tree.
 *
 * @category Stream fixture
 */
export function setActiveTelemetryClientForTests(
  client: TelemetryClient | undefined,
): void {
  activeTelemetryClient = client;
  notifyActiveTelemetryClientListeners();
  syncTopicHolds();
}

/**
 * Calls `cb` each time the mounted `TelemetryProvider` takes in a new frame,
 * and returns a function that stops it. Useful for a service outside React that
 * has to re-run its on-demand reads, such as `getVesselOrbit()`, whenever the
 * vessel's telemetry changes. Used by the go/no-go host service and the
 * maneuver-trigger host service.
 *
 * The subscription follows whichever store is active at each frame, so it can
 * be taken out before any provider is mounted and survives a provider that
 * unmounts and remounts.
 */
export function onActiveTimelineFrame(cb: () => void): () => void {
  timelineFrameListeners.add(cb);
  syncTimelineFrameBridge();
  return () => {
    timelineFrameListeners.delete(cb);
    syncTimelineFrameBridge();
  };
}

/**
 * Subscribes to `topic` on the wire for a caller with no component to mount,
 * and returns a function that releases it. A derived Topic or a field path
 * holds the raw Topics that feed it. Useful for a service outside React that
 * samples a Topic nothing else is subscribed to.
 *
 * It does what `useTelemetry` does while mounted. Without a hold, a sample of
 * that Topic stays `pending`, or returns the last payload of a widget that has
 * since let go. The hold outlives the provider: taken before one mounts, it
 * subscribes when one does, and it follows a provider that unmounts and
 * remounts.
 *
 * A hold makes the Topic arrive and says nothing about how current the next
 * read is. Until the first frame lands after subscribing, a sample still returns
 * the previous holder's point, so a caller acting on it reads through
 * `sampleActiveReading` and branches on `state`.
 */
export function holdActiveTopicRead(
  topic: string,
  subscriberLabel?: string,
): () => void {
  const token = Symbol(topic);
  topicHolds.set(token, { topic, label: subscriberLabel });
  syncTopicHolds();
  return () => {
    topicHolds.delete(token);
    topicHoldReleases.get(token)?.();
    topicHoldReleases.delete(token);
  };
}
