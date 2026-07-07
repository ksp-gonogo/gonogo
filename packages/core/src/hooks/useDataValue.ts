import {
  isTopicCarried,
  mapTopic,
  useCarriedChannelsOptional,
  useTelemetryClientOptional,
  useTelemetryStoreOptional,
} from "@gonogo/sitrep-client";
import { useCallback, useSyncExternalStore } from "react";
import type { DataSource, DataSourceRegistry } from "../types";
import { useDataSourceSubscription } from "./useDataSourceSubscription";

/**
 * Subscribe to a live value from a registered data source.
 *
 * **Typed overload** — when the source ID is registered in `DataSourceRegistry`,
 * the key is constrained to valid keys for that source and the return type is
 * inferred automatically:
 *
 *   // DataSourceRegistry has { data: { 'v.altitude': number; ... } }
 *   const alt = useDataValue('data', 'v.altitude');
 *   //    ^ number | undefined  ✓  — no <T> annotation needed
 *
 * **Fallback overload** — for sources not yet in the registry, or when an
 * explicit type annotation is preferred (backward-compatible with existing code):
 *
 *   const val = useDataValue<boolean>('data', dynamicKey);
 *   //    ^ boolean | undefined
 *
 * ---
 *
 * **The M3 `useStream` compatibility shim (M2 Task 7).** Internally this
 * hook now routes through `mapTopic(dataSourceId, key)`
 * (`@gonogo/sitrep-client`, seeded from `m1-provider-taxonomy-design.md`
 * §5's old-Telemachus-key → new-stream-topic migration table):
 *
 * - **Mapped key + a `TelemetryProvider` is mounted + the resolved topic is
 *   CARRIED** → reads reactively from the `TimelineStore` the provider feeds
 *   (the M2 bridge task's fix — see below), so a widget that has been
 *   quietly reclassified in the migration table starts riding the new
 *   streaming pipeline with ZERO code change and zero test change — the
 *   return contract (`T | undefined`, `undefined` while nothing has arrived
 *   yet) is identical.
 * - **Unmapped key, no `TelemetryProvider` in the tree yet, or the resolved
 *   topic is NOT carried** → falls back to the legacy registered `DataSource`
 *   path unchanged. This is what lets M3 migrate widgets (and mount
 *   `TelemetryProvider`) group-by-group: an unmigrated screen with no
 *   provider behaves exactly as it does today, a key the migration table
 *   hasn't reached yet (an M1 §5.2 "known gap") keeps working off the old
 *   `DataSource` even once the provider is live, and — the M3 Wave 0
 *   carried-channels allowlist gate (`m3-migration-plan.md` §5.1) — a MAPPED
 *   key whose stream the mounted transport doesn't actually carry ALSO stays
 *   on the working legacy read instead of resolving to a permanent
 *   loading-forever `undefined`. See the gate's own comment further down for
 *   the full "why" — this is the fix for the plan's "big-bang blank-out"
 *   cliff.
 *
 * **The M2 bridge task.** `mapTopic` frequently targets a DERIVED topic
 * (`vessel.state.<field>` — the V-12 dual-altitude fix). A derived topic is
 * never itself a wire topic; nothing sends it, so the shim can't just
 * `client.subscribe`/`client.getValue` it directly the way it used to (that
 * was the exact bug this task fixes — a mapped derived key read as
 * permanently-dead `undefined` even with a provider mounted, since nothing
 * fed the `TimelineStore` that would have derived it). Instead the streamed
 * branch mirrors `useStream` (`@gonogo/sitrep-client`'s `use-stream.ts` —
 * that file is the source of truth if its subscribe/getSnapshot contract
 * ever changes):
 * - `store.resolveSubscriptionTopics(topic)` resolves `topic` down to the
 *   raw input topics that actually need subscribing (identity for an
 *   already-raw topic), and each is subscribed via `client.subscribe`
 *   (ref-counted, symmetric unsubscribe on cleanup) — this is what makes the
 *   `TimelineStore` the provider feeds actually receive the data a derived
 *   channel needs.
 * - The value itself is read via `store.sample(topic, store.currentFrame())`,
 *   which resolves raw AND derived topics through the one surface.
 * - **Fallback safety** (belt-and-suspenders, defensive even after the fix
 *   above): if the streamed read is `undefined` AND
 *   `store.isUnresolvableField(topic)` says this specific `topic` can never
 *   resolve (a registered derived parent produced a whole record that
 *   genuinely lacks the requested field — a phantom migration-table entry,
 *   not ordinary "still loading"), the shim falls back to the legacy value
 *   instead of serving a permanent dead `undefined` for a key that has a
 *   working legacy read. Ordinary loading (parent not whole yet, or a
 *   healthy field that just hasn't arrived) still returns `undefined` and
 *   does NOT fall back — the mapped-key-bypasses-legacy contract above holds.
 *
 * The one semantic delta, flagged rather than silently reproduced (M2 design
 * §6): the legacy path clears to `undefined` when the `DataSource` status
 * leaves `"connected"`; the new streamed path does not — a `TelemetryClient`
 * holds the last-known value (M2's staleness model supersedes blunt
 * clear-on-disconnect, but that richer status only reaches a widget once
 * *it* is consciously migrated to `useStreamStatus` in M3). Until then this
 * is a defensible, documented gap, not a silent regression.
 *
 * Both the legacy subscription and the streamed subscription are always
 * wired up (stable hook order — this hook must not call a different set of
 * hooks across renders); only one of the two snapshots is actually returned,
 * chosen by whether `mapTopic` produced a topic and a provider is mounted.
 * Deleted at M4 per the shim's own retirement plan.
 */
// Typed overload: source is in DataSourceRegistry → key and return type are inferred
export function useDataValue<
  TSource extends keyof DataSourceRegistry,
  TKey extends keyof DataSourceRegistry[TSource] & string,
>(
  dataSourceId: TSource,
  key: TKey,
): DataSourceRegistry[TSource][TKey] | undefined;

// Fallback overload: source NOT in DataSourceRegistry, or explicit T annotation.
// Excludes known source IDs so that passing a registered source with an invalid
// key produces a compile error rather than silently falling through to unknown.
export function useDataValue<T = unknown>(
  dataSourceId: Exclude<string, keyof DataSourceRegistry>,
  key: string,
): T | undefined;

// Implementation (not part of the public API surface)
export function useDataValue(dataSourceId: string, key: string): unknown {
  // Kept wired even once a key is migrated (streamedValue wins below) so the
  // hook's call order never changes across renders — a wasted subscription
  // and re-render on the legacy path, traded deliberately for hook-order
  // stability. Transitional: goes away with the shim at M4.
  const legacySetup = useCallback(
    (
      source: DataSource,
      notify: () => void,
      snapshotRef: { current: unknown },
    ) => {
      const unsubData = source.subscribe(key, (val) => {
        snapshotRef.current = val;
        notify();
      });
      const unsubStatus = source.onStatusChange((status) => {
        if (status !== "connected") {
          snapshotRef.current = undefined;
          notify();
        }
      });
      return () => {
        unsubData();
        unsubStatus();
      };
    },
    [key],
  );
  const legacyValue = useDataSourceSubscription<unknown>(
    dataSourceId,
    legacySetup,
    undefined,
  );

  // The shim: always subscribed (stable hook order), only consulted when
  // `mapTopic` resolves AND a TelemetryProvider is actually mounted (client
  // AND store both present — `TelemetryProvider` always mounts them
  // together, see `context.tsx`) AND the resolved topic is actually CARRIED
  // (M3 Wave 0 carried-channels allowlist gate, `m3-migration-plan.md` §5.1 —
  // the safety mechanism against the "big-bang blank-out"). This half
  // deliberately mirrors `useStream` (`@gonogo/sitrep-client`'s
  // `use-stream.ts`) — that file is the source of truth if its
  // subscribe/getSnapshot contract ever changes.
  //
  // **The carried-channels gate.** Before this gate existed, a mapped topic
  // routed to the stream the instant a provider mounted, REGARDLESS of
  // whether the mounted transport actually delivered it — any unserved
  // mapped topic (mod not deployed, channel not in the recording, gap-fill
  // not landed) resolved to a permanent loading `undefined`, blanking the
  // widget instead of falling back to its working legacy read. `carried`
  // below is the fix: `store.resolveSubscriptionTopics(topic)` resolves
  // `topic` down to its raw wire inputs (identity for an already-raw
  // topic — a DERIVED topic like `vessel.state.altitudeAsl` resolves to
  // `["vessel.orbit", "vessel.flight"]`), and `carried` is true only when
  // EVERY one of those inputs is in the provider's carried-channels
  // allowlist (`useCarriedChannelsOptional` — seeded from the transport's
  // own declared channels, unioned with an explicit dev-first promotion
  // list, see `TelemetryProvider`'s `carriedChannels` prop). A partially-fed
  // derived channel (one input carried, one not) is NOT carried — it can
  // never produce a whole record, so treating it as carried would
  // reintroduce the exact blank-out this gate exists to prevent. `carried`
  // is a pure set-membership check re-evaluated every render, so promoting a
  // topic (growing the allowlist, which only ever grows — see
  // `TelemetryProvider`) flips `routable` from `false` to `true` and never
  // back, satisfying the monotonic "legacy -> stream, never the reverse"
  // contract this gate is required to hold.
  const client = useTelemetryClientOptional();
  const store = useTelemetryStoreOptional();
  const carriedChannels = useCarriedChannelsOptional();
  const topic = mapTopic(dataSourceId, key);
  const carried =
    store !== undefined &&
    topic !== undefined &&
    carriedChannels !== undefined &&
    isTopicCarried(store, carriedChannels, topic);
  const routable =
    client !== undefined &&
    store !== undefined &&
    topic !== undefined &&
    carried;

  const subscribeStream = useCallback(
    (onStoreChange: () => void) => {
      if (!client || !store || topic === undefined || !carried) {
        return () => {};
      }
      const inputTopics = store.resolveSubscriptionTopics(topic);
      const unsubscribeInputs = inputTopics.map((inputTopic) =>
        client.subscribe(inputTopic, () => {}),
      );
      const unsubscribeFrame = store.subscribeFrame(onStoreChange);
      return () => {
        unsubscribeFrame();
        for (const unsubscribe of unsubscribeInputs) unsubscribe();
      };
    },
    [client, store, topic, carried],
  );
  const getStreamSnapshot = useCallback(() => {
    if (!store || topic === undefined || !carried) return undefined;
    const point = store.sample(topic, store.currentFrame());
    return point ? point.payload : undefined;
  }, [store, topic, carried]);
  const streamedValue = useSyncExternalStore(
    subscribeStream,
    getStreamSnapshot,
  );

  if (routable) {
    if (streamedValue !== undefined) return streamedValue;
    // Belt-and-suspenders fallback (M2 bridge task, Fix 1 item 4): a mapped
    // topic that's structurally unable to ever resolve (a phantom
    // migration-table entry — see `store.isUnresolvableField`'s doc) falls
    // back to the legacy value rather than serving a permanent dead
    // `undefined` for a key with a working legacy read. Ordinary loading
    // (nothing arrived yet) is NOT this case and stays `undefined` —
    // preserving the mapped-key-bypasses-legacy contract this shim has had
    // since M2 Task 7.
    if (store && topic !== undefined && store.isUnresolvableField(topic)) {
      return legacyValue;
    }
    return streamedValue;
  }
  return legacyValue;
}
