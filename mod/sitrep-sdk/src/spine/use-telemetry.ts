import { useCallback, useEffect, useSyncExternalStore } from "react";
import { getDataSource } from "../api/registry";
import type { DataSource } from "../api/types";
import { isTopicCarried } from "../carried-channels";
import type { Reading, UnmodelledReading } from "../reading";
import type { TopicId, TopicPayload } from "../topics";
import {
  useCarriedChannelsOptional,
  useTelemetryClientOptional,
  useTelemetryStoreOptional,
} from "./context";
import { warnGatedRead } from "./gated-read-warning";
import { resolveValueTopic } from "./map-topic";
import type { NeverReckonable } from "./never-reckonable";
import { useTelemetrySubscriberLabel } from "./subscriber-identity";
import { useDataSourceSubscription } from "./use-data-source-subscription";

/**
 * Subscribe to a live value. The **canonical** telemetry read hook of the
 * Uplink architecture: the rename of the historical `useDataValue`, which is
 * gone entirely. No alias survives it, `@ksp-gonogo/core` re-exports this hook
 * under its own name and nothing exports the old one.
 *
 * **Canonical Topic overload**: the forward-looking shape. Keyed directly by
 * a typed `TopicId` from `@ksp-gonogo/sitrep-sdk`, it reads that Topic's payload
 * straight off the mounted `TimelineStore` and returns the Topic's payload
 * type:
 *
 *   const orbit = useTelemetry('vessel.orbit');
 *   //    ^ VesselOrbit | undefined : TopicPayload<'vessel.orbit'>
 *
 * The `| undefined` reflects the honest Phase-0 runtime contract (nothing has
 * arrived yet, or no `TelemetryProvider` is mounted). The per-widget manifest
 * layer (optionality inference, a later phase) narrows required Topics
 * to non-null on top of this base hook; it does not change this signature.
 * Unlike the legacy migration shim below, the canonical Topic read does **not**
 * consult the M3 carried-channels allowlist, that gate exists only to protect
 * a legacy fallback, and a native Topic read has none.
 *
 * The two-arg legacy overloads (`useTelemetry(dataSourceId, key)`) are a
 * compile error THROUGH THIS MODULE: every production caller has migrated to
 * the canonical Topic form above. They are NOT a compile error through the
 * SDK's published root barrel, which still declares the pair for an Uplink
 * reading a legacy flat key (see `GonogoHost.useTelemetry`'s doc), so the
 * runtime branch below is a live third-party surface and not merely test
 * scaffolding. It is torn out with the shim itself at M4.
 *
 * ---
 *
 * **The M3 `useStream` compatibility shim (M2 Task 7).** For the two-arg legacy
 * overloads this hook routes through `mapTopic(dataSourceId, key)`
 * against a legacy-key to stream-topic migration table:
 *
 * - **Mapped key + a `TelemetryProvider` is mounted + the resolved topic is
 *   CARRIED** → reads reactively from the `TimelineStore` the provider feeds
 *   (the M2 bridge task's fix: see below), so a widget that has been
 *   quietly reclassified in the migration table starts riding the new
 *   streaming pipeline with ZERO code change and zero test change, the
 *   return contract (`T | undefined`, `undefined` while nothing has arrived
 *   yet) is identical.
 * - **Unmapped key, no `TelemetryProvider` in the tree yet, or the resolved
 *   topic is NOT carried** → prefers the legacy registered `DataSource` path.
 *   This is what lets a screen mount `TelemetryProvider` without every read on
 *   it having to move at once: a screen with no provider behaves as it always
 *   does, a key the migration table does not cover keeps working off its
 *   `DataSource` even once the provider is live, and, through the
 *   carried-channels allowlist gate, a MAPPED key whose stream the mounted
 *   transport does not actually carry ALSO stays on the working fallback read
 *   instead of resolving to a permanent loading-forever `undefined`. See the
 *   gate's own comment further down for the full "why": it is what prevents a
 *   whole-dashboard blank-out. **Preference, not exclusion**: an uncarried
 *   topic is still subscribed, and if the legacy read has nothing to say the
 *   streamed value is served rather than a permanent `undefined`, because on a
 *   `dataSourceId` with no registered source behind it, "fall back to legacy"
 *   is "fall back to silence". That case is logged once, see
 *   `gated-read-warning.ts`.
 *
 * **Derived topics.** `mapTopic` frequently targets a DERIVED topic
 * (`vessel.state.<field>`). A derived topic is never itself a wire topic;
 * nothing sends it, so the shim cannot `client.subscribe`/`client.getValue` it
 * directly: doing so reads a mapped derived key as permanently-dead
 * `undefined` even with a provider mounted, because nothing feeds the
 * `TimelineStore` that would derive it. Instead the streamed branch mirrors
 * `useStream` (`@ksp-gonogo/sitrep-client`'s `use-stream.ts`,
 * that file is the source of truth if its subscribe/getSnapshot contract
 * ever changes):
 * - `store.resolveSubscriptionTopics(topic)` resolves `topic` down to the
 *   raw input topics that actually need subscribing (identity for an
 *   already-raw topic), and each is subscribed via `client.subscribe`
 *   (ref-counted, symmetric unsubscribe on cleanup): this is what makes the
 *   `TimelineStore` the provider feeds actually receive the data a derived
 *   channel needs.
 * - The value itself is read via `store.sample(topic, store.currentFrame())`,
 *   which resolves raw AND derived topics through the one surface.
 * - **Fallback safety** (belt-and-suspenders, defensive even after the fix
 *   above): if the streamed read is `undefined` AND
 *   `store.isUnresolvableField(topic)` says this specific `topic` can never
 *   resolve (a registered derived parent produced a whole record that
 *   genuinely lacks the requested field: a phantom migration-table entry,
 *   not ordinary "still loading"), the shim falls back to the legacy value
 *   instead of serving a permanent dead `undefined` for a key that has a
 *   working legacy read. Ordinary loading (parent not whole yet, or a
 *   healthy field that just hasn't arrived) still returns `undefined` and
 *   does NOT fall back, the mapped-key-bypasses-legacy contract above holds.
 *
 * The one semantic delta, flagged rather than silently reproduced:
 * the legacy path clears to `undefined` when the `DataSource` status
 * leaves `"connected"`; the new streamed path does not, a `TelemetryClient`
 * holds the last-known value (M2's staleness model supersedes blunt
 * clear-on-disconnect, but that richer status only reaches a widget once
 * *it* is consciously migrated to `useStreamStatus` in M3). Until then this
 * is a defensible, documented gap, not a silent regression.
 *
 * Both the legacy subscription and the streamed subscription are always
 * wired up (stable hook order: this hook must not call a different set of
 * hooks across renders); only one of the two snapshots is actually returned,
 * chosen by whether a topic resolved and a provider is mounted. Deleted at M4
 * per the shim's own retirement plan.
 */
/**
 * One shared `pending` for the canonical no-provider path. A fresh object per
 * call would fail `useSyncExternalStore`'s reference comparison and loop.
 */
const CANONICAL_PENDING: Reading<never> = {
  state: "pending",
  reckoning: "none",
};

/**
 * Canonical overload: keyed by TopicId, returns the Topic's `Reading`.
 *
 * ## Why the reading and not the payload
 *
 * This returned a bare payload, and a second hook returned the reading. The
 * numbers settled it: 218 call sites on this one, 2 on the other. `Reading`'s
 * whole justification is that "reaching a value at all requires branching on how
 * current it is", and that was only true for the sites that opted in.
 *
 * Which is the SAME failure the reading was built to fix, one layer up.
 * `StreamStatusValue` was built end to end and read by zero of the thirty-nine
 * widgets that stream telemetry, because a badge beside a body is chrome and
 * nothing makes the body consult it. A beside-the-value HOOK is chrome too. So
 * there is one hook, and the compile break is the migration: there is no way to
 * reach a value without confronting its currency, because the only hook that
 * hands one over makes you write the discriminant first.
 *
 * For a topic in `NEVER_RECKONABLE` the return narrows to `UnmodelledReading`,
 * which drops every `reckoning: "available"` member, so a caller cannot write a
 * branch for a case that can never occur. Reckonability is a SECOND
 * discriminant rather than an arm of `state`, so nothing is dropped from
 * `state` itself: `stale` remains, and remains the judgement.
 *
 * ## The compile break does NOT always happen, and this is the trap
 *
 * Passing this hook's result straight into something that wants the PAYLOAD is
 * meant to be a type error, and usually is. It is not when the payload type has
 * every field optional, which most generated Uplink payloads do: a `Reading` is
 * then structurally assignable to it, so `<Widget weather={useTelemetry(...)} />`
 * typechecks and hands the widget an object carrying none of its fields.
 *
 * That is not hypothetical. An Uplink's radiation-trend test drove a "live
 * trend" off two samples that measured nothing, for exactly this reason, and
 * passed for as long as the widget rendered absence as zero. Unwrap the
 * discriminant, even where the compiler does not force you to.
 */
export function useTelemetry<T extends TopicId>(
  topic: T,
): T extends NeverReckonable
  ? UnmodelledReading<TopicPayload<T>>
  : Reading<TopicPayload<T>>;

// Implementation (not part of the public API surface)
export function useTelemetry(dataSourceId: string, key?: string): unknown {
  // The single-argument canonical form: `dataSourceId` IS the TopicId, read
  // straight off the mounted store. The two-argument legacy form keeps every
  // behaviour of the historical `useDataValue`. `canonical` is fixed for the
  // lifetime of a given call site (a call is always one-arg or always two-arg),
  // so branching on it never changes this hook's call order across renders.
  const canonical = key === undefined;

  // Kept wired even once a key is migrated (streamedValue wins below) so the
  // hook's call order never changes across renders, a wasted subscription
  // and re-render on the legacy path, traded deliberately for hook-order
  // stability. Transitional: goes away with the shim at M4. In canonical mode
  // there is no legacy source (the TopicId is not a registered DataSource id),
  // so this resolves to `undefined` and never surfaces.
  const legacyKey = key ?? "";
  const legacySetup = useCallback(
    (
      source: DataSource,
      notify: () => void,
      snapshotRef: { current: unknown },
    ) => {
      const unsubData = source.subscribe(legacyKey, (val) => {
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
    [legacyKey],
  );
  const legacyValue = useDataSourceSubscription<unknown>(
    dataSourceId,
    legacySetup,
    undefined,
  );

  // The shim: subscribed whenever a topic resolves AND a TelemetryProvider is
  // actually mounted (client AND store both present: `TelemetryProvider` always
  // mounts them together, see `context.tsx`). This half deliberately mirrors
  // `useStream` (`@ksp-gonogo/sitrep-client`'s `use-stream.ts`), that file is the
  // source of truth if its subscribe/getSnapshot contract ever changes.
  //
  // **The carried-channels gate.** Before this gate existed, a mapped topic
  // routed to the stream the instant a provider mounted, REGARDLESS of
  // whether the mounted transport actually delivered it, any unserved
  // mapped topic (mod not deployed, channel not in the recording, gap-fill
  // not landed) resolved to a permanent loading `undefined`, blanking the
  // widget instead of falling back to its working legacy read. `carried`
  // below is the fix: `store.resolveSubscriptionTopics(topic)` resolves
  // `topic` down to its raw wire inputs (identity for an already-raw
  // topic: a DERIVED topic like `vessel.state.altitudeAsl` resolves to
  // `["vessel.orbit", "vessel.flight"]`), and `carried` is true only when
  // EVERY one of those inputs is in the provider's carried-channels
  // allowlist (`useCarriedChannelsOptional`: seeded from the transport's
  // own declared channels, unioned with an explicit dev-first promotion
  // list, see `TelemetryProvider`'s `carriedChannels` prop). A partially-fed
  // derived channel (one input carried, one not) is NOT carried, it can
  // never produce a whole record, so treating it as carried would
  // reintroduce the exact blank-out this gate exists to prevent. `carried`
  // is a pure set-membership check re-evaluated every render, so promoting a
  // topic (growing the allowlist, which only ever grows; see
  // `TelemetryProvider`) flips a legacy read onto the stream and never back,
  // satisfying the monotonic "legacy -> stream, never the reverse" contract
  // this gate is required to hold.
  //
  // **What the gate is, and what it is NOT.** It picks between two live reads;
  // it is not permission to reach the stream. It used to be both: an uncarried
  // topic short-circuited `subscribeStream` to a no-op, so the read never
  // reached a channel at all. That is safe only while the legacy read it
  // diverts to actually exists, and it does not: nothing in the app registers a
  // `DataSource` under the flat-key id `"data"` any more, so on that id the gate
  // was choosing between the stream and silence. Worse, choosing silence made
  // itself invisible, because `installUnownedTopicWarning` can only report
  // topics something subscribed to. So the subscription is now unconditional
  // (`streamable`) and `carried` decides only which of the two VALUES is
  // returned, below: the legacy one when it has anything to say, which is the
  // behaviour the gate was written for, and the streamed one rather than
  // nothing when it does not.
  //
  // The canonical Topic read skips the gate entirely, it has no legacy
  // fallback to protect, so it streams whenever a provider carries the store.
  const client = useTelemetryClientOptional();
  const store = useTelemetryStoreOptional();
  const carriedChannels = useCarriedChannelsOptional();
  const topic = canonical
    ? (dataSourceId as TopicId)
    : resolveValueTopic(dataSourceId, key ?? "");
  const carried = canonical
    ? store !== undefined && topic !== undefined
    : store !== undefined &&
      topic !== undefined &&
      carriedChannels !== undefined &&
      isTopicCarried(store, carriedChannels, topic);
  // Whether there is a stream to read at all, independent of the gate.
  const streamable =
    client !== undefined && store !== undefined && topic !== undefined;
  const routable = streamable && carried;

  // Diagnostics only: which widget this read belongs to, so a topic nothing
  // publishes can be reported with the name of the thing that asked for it.
  const subscriberLabel = useTelemetrySubscriberLabel();
  const subscribeStream = useCallback(
    (onStoreChange: () => void) => {
      if (!client || !store || topic === undefined) {
        return () => {};
      }
      const inputTopics = store.resolveSubscriptionTopics(topic);
      const unsubscribeInputs = inputTopics.map((inputTopic) =>
        client.subscribe(inputTopic, () => {}),
      );
      // Labelled per INPUT topic rather than per read: a derived topic is not
      // a wire topic and can never be unowned itself, so the diagnostic has to
      // name the raw topics the derivation actually subscribed.
      const releaseLabels = subscriberLabel
        ? inputTopics.map((inputTopic) =>
            client.noteSubscriberLabel(inputTopic, subscriberLabel),
          )
        : [];
      const unsubscribeFrame = store.subscribeFrame(onStoreChange);
      return () => {
        unsubscribeFrame();
        for (const release of releaseLabels) release();
        for (const unsubscribe of unsubscribeInputs) unsubscribe();
      };
    },
    [client, store, topic, subscriberLabel],
  );
  const getStreamSnapshot = useCallback(() => {
    if (!store || topic === undefined) return undefined;
    // The canonical form hands over the whole `Reading`; the legacy two-arg form
    // keeps its historical bare value. `sampleReading` rather than composing
    // sample + sampleStatus here: it memoizes the union on the store's per-frame
    // cache, and `useSyncExternalStore` compares snapshots by reference, so a
    // fresh object per call would loop forever rather than merely allocate.
    if (canonical) return store.sampleReading(topic, store.currentFrame());
    const point = store.sample(topic, store.currentFrame());
    return point ? point.payload : undefined;
  }, [store, topic, canonical]);
  const streamedValue = useSyncExternalStore(
    subscribeStream,
    getStreamSnapshot,
  );

  // The gate is about to hide a value the stream has: the only moment this is
  // observable, and reported from an effect so a render React discards never
  // prints. See `warnGatedRead`.
  //
  // Reported only when there is no registered source at all, which is the
  // unambiguous case. A registered source that has simply not emitted yet is
  // rescued too, and is not worth a line: it resolves itself the moment the
  // source speaks, and a warning fires once per read for the whole session, so
  // a transient one would outlive its own cause and bury the real report.
  const hasLegacySource = getDataSource(dataSourceId) !== undefined;
  const gatedRescue =
    !canonical &&
    !routable &&
    streamable &&
    topic !== undefined &&
    legacyValue === undefined &&
    streamedValue !== undefined;
  useEffect(() => {
    if (gatedRescue && !hasLegacySource && store && topic !== undefined) {
      warnGatedRead(
        "useTelemetry",
        dataSourceId,
        legacyKey,
        topic,
        store.resolveSubscriptionTopics(topic),
      );
    }
  }, [gatedRescue, hasLegacySource, dataSourceId, legacyKey, topic, store]);

  // A canonical read with no provider mounted is `pending`, never `undefined`: a
  // widget on a disconnected dashboard has observed nothing, so it has no
  // last-observed value, and any other arm would promise one it cannot supply.
  // Shared object, because `useSyncExternalStore` compares by reference.
  if (canonical && !routable) return CANONICAL_PENDING;

  if (routable) {
    if (streamedValue !== undefined) return streamedValue;
    // Belt-and-suspenders fallback (M2 bridge task, Fix 1 item 4): a mapped
    // topic that's structurally unable to ever resolve (a phantom
    // migration-table entry: see `store.isUnresolvableField`'s doc) falls
    // back to the legacy value rather than serving a permanent dead
    // `undefined` for a key with a working legacy read. Ordinary loading
    // (nothing arrived yet) is NOT this case and stays `undefined`,
    // preserving the mapped-key-bypasses-legacy contract this shim has had
    // since M2 Task 7.
    if (store && topic !== undefined && store.isUnresolvableField(topic)) {
      return legacyValue;
    }
    return streamedValue;
  }

  // Gated off, so the legacy read is the preferred answer and gets first refusal:
  // that ordering IS the gate, and it is unchanged. What changed is the tie-break
  // when it declines. A legacy read that says nothing used to end the matter, and
  // on a `dataSourceId` no longer backed by a registered source it said nothing
  // for ever. The streamed value now stands in, and is reported once so the call
  // site can be moved to the canonical form rather than left riding a rescue.
  if (legacyValue !== undefined) return legacyValue;
  return gatedRescue ? streamedValue : legacyValue;
}
