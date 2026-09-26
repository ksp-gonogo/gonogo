import {
  type AnyContribution,
  hasHost,
  logger,
  PerfBudget,
  type TopicId,
} from "@ksp-gonogo/sitrep-sdk";
import {
  activateProcessor,
  evaluateActiveProcessors,
  type FrameToken,
  getContributionsForSlot,
  getProcessorValue,
  onContributionsChange,
  type ProcessorHandle,
  runContributionCompute,
  subscribeTopicRead,
  useTelemetryClientOptional,
  useTelemetryStoreOptional,
} from "@ksp-gonogo/sitrep-sdk/spine";
import {
  type ReactElement,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
} from "react";
import {
  COMPONENT_SLOT_SEGMENTS,
  type ContributionSlotEntry,
  ContributionsPanelStore,
  useContributions,
  useContributionsBySlotId,
} from "./contributionsRead";
import type { Store } from "./store/createStore";
import { useWidgetMeta } from "./WidgetMetaContext";

/*
 * The contribution WRITE seam: the per-frame aggregation that pulls each
 * contribution's telemetry deps and fans the computed entries into the
 * per-widget `ContributionsPanelStore` the read hooks share.
 */

/*
 * One PerfBudget per slot id, created lazily since slot ids are open-ended. It
 * counts entry sets that actually MOVED, not aggregation passes, which run on
 * every animation frame; 30 is about 3x the wire sample rate.
 */
const slotBudgets = new Map<string, PerfBudget>();
function getSlotPerfBudget(slot: string): PerfBudget {
  let budget = slotBudgets.get(slot);
  if (!budget) {
    budget = new PerfBudget({
      name: `Contributions "${slot}" entries recomputed/sec`,
      threshold: 30,
      windowMs: 1000,
      unit: "recomputes",
    });
    slotBudgets.set(slot, budget);
  }
  return budget;
}

// Stable empty snapshot with no `TelemetryProvider`: a fresh `{}` would make `useSyncExternalStore` see a change every render.
const EMPTY_TOPIC_VALUES: Readonly<Record<string, unknown>> = Object.freeze({});

// Memoised per slot, since useSyncExternalStore needs a referentially stable snapshot between changes.
const slotCache = new Map<string, AnyContribution[]>();
let cacheValid = false;
onContributionsChange(() => {
  cacheValid = false;
  slotCache.clear();
});
function getContributionsForSlotCached(slot: string): AnyContribution[] {
  if (!cacheValid) {
    slotCache.clear();
    cacheValid = true;
  }
  let cached = slotCache.get(slot);
  if (cached === undefined) {
    cached = getContributionsForSlot(slot);
    slotCache.set(slot, cached);
  }
  return cached;
}

/**
 * True when the two entries carry the same value: the same reference, or two
 * objects shallow-equal over their own keys. Reference equality alone would
 * never hold, since the aggregation stamps provenance onto a fresh row every
 * frame. Shallow, because the rows are flat.
 */
function entryUnchanged(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== "object" || typeof b !== "object") return false;
  if (a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const aKeys = Object.keys(a);
  if (aKeys.length !== Object.keys(b).length) return false;
  for (const key of aKeys) {
    if (
      !Object.is(
        (a as Record<string, unknown>)[key],
        (b as Record<string, unknown>)[key],
      )
    ) {
      return false;
    }
  }
  return true;
}

/** Element-wise: true when every entry holds the same value as before. */
function entriesUnchanged(
  a: readonly unknown[],
  b: readonly unknown[],
): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (!entryUnchanged(a[i], b[i])) return false;
  }
  return true;
}

function shallowEqualValues(
  a: Record<string, unknown>,
  b: Record<string, unknown>,
): boolean {
  const keys = Object.keys(a);
  if (keys.length !== Object.keys(b).length) return false;
  return keys.every((k) => Object.hasOwn(b, k) && Object.is(a[k], b[k]));
}

/** The topics a contribution declared, which it may read through any seam unreported. */
function declaredTopicsOf(def: AnyContribution): ReadonlySet<string> {
  const topics = new Set<string>();
  for (const d of def.deps ?? []) {
    if (typeof d === "string") topics.add(d);
    else if ("reading" in d) topics.add(d.reading);
  }
  if (def.requires) topics.add(`${def.requires}.available`);
  return topics;
}

/**
 * One slot's aggregation pipeline: bulk-reads the union of every gated-in
 * contribution's `deps` once per frame, calls each `compute()` in a plain loop
 * (no hooks, so the registered set may change freely), isolates a throwing
 * contribution, and writes the result under this slot's key. Its own
 * component, so each slot's hooks have a stable position.
 */
function SlotAggregator({
  slot,
  store,
}: {
  slot: string;
  store: Store<ContributionSlotEntry>;
}) {
  const contribs = useSyncExternalStore(
    onContributionsChange,
    () => getContributionsForSlotCached(slot),
    () => getContributionsForSlotCached(slot),
  );

  const unionDeps = useMemo(() => {
    const topics = new Set<TopicId>();
    const processors = new Map<string, ProcessorHandle<unknown>>();
    // A `requires` domain needs its own `.available` subscription: a transport only delivers a topic something subscribed to.
    for (const c of contribs) {
      for (const d of c.deps ?? []) {
        if (typeof d === "string") topics.add(d as TopicId);
        // A reading dep subscribes to the same wire topic a bare id does.
        else if ("reading" in d) topics.add(d.reading as TopicId);
        else processors.set(d.id, d);
      }
      if (c.requires) topics.add(`${c.requires}.available` as TopicId);
    }
    return {
      topics: Array.from(topics),
      processors: Array.from(processors.values()),
    };
  }, [contribs]);

  const client = useTelemetryClientOptional();
  const telemetryStore = useTelemetryStoreOptional();

  // Processor freshness rides the same frame boundary as the Topic reads, so no per-processor subscription is needed.
  useEffect(() => {
    const deactivates = unionDeps.processors.map((p) =>
      activateProcessor(p.id),
    );
    return () => {
      for (const d of deactivates) d();
    };
  }, [unionDeps.processors]);

  const subscribe = useCallback(
    (onChange: () => void) => {
      if (!client || !telemetryStore) return () => {};
      // Through the shared read seam, which also holds up each dep's reckoner inputs.
      const unsubscribeInputs = unionDeps.topics.map((topic) =>
        subscribeTopicRead(client, telemetryStore, topic),
      );
      const unsubscribeFrame = telemetryStore.subscribeFrame(() => {
        // Evaluate Processors BEFORE notifying React: this listener can fire before the evaluator's shared one. Idempotent.
        if (unionDeps.processors.length > 0) evaluateActiveProcessors();
        onChange();
      });
      return () => {
        unsubscribeFrame();
        for (const u of unsubscribeInputs) u();
      };
    },
    [client, telemetryStore, unionDeps],
  );

  // Keyed on the `FrameToken`, which is stable for a whole frame, so re-reads within one frame return the identical object.
  const topicCacheRef = useRef<{
    token: FrameToken;
    values: Record<string, unknown>;
  } | null>(null);

  const getSnapshot = useCallback((): Record<string, unknown> => {
    if (!telemetryStore) return EMPTY_TOPIC_VALUES;
    if (unionDeps.topics.length === 0 && unionDeps.processors.length === 0) {
      return EMPTY_TOPIC_VALUES;
    }
    const token = telemetryStore.currentFrame();
    const cached = topicCacheRef.current;
    if (cached && cached.token === token) return cached.values;
    const values: Record<string, unknown> = {};
    for (const topic of unionDeps.topics) {
      const point = telemetryStore.sample(topic, token);
      values[topic] = point ? point.payload : undefined;
    }
    for (const p of unionDeps.processors) {
      values[p.id] = getProcessorValue(p.id);
    }
    /*
     * A frame arrives every animation tick whether or not anything moved, so
     * the previous object is kept while its contents are unchanged. Work that
     * must advance with the clock belongs in a processor.
     */
    const next =
      cached && shallowEqualValues(cached.values, values)
        ? cached.values
        : values;
    topicCacheRef.current = { token, values: next };
    return next;
  }, [telemetryStore, unionDeps]);

  const topicValues = useSyncExternalStore(subscribe, getSnapshot);
  const budget = useMemo(() => getSlotPerfBudget(slot), [slot]);

  useEffect(() => {
    const collected: unknown[] = [];
    for (const def of contribs) {
      if (
        def.requires &&
        client?.getValue(`${def.requires}.available`) === undefined
      ) {
        continue; // Domain absent: this contribution does not run.
      }
      try {
        const result = runContributionCompute(
          def.id,
          declaredTopicsOf(def),
          () => def.compute(topicValues as never),
        );
        if (result) {
          for (const entry of result) {
            if (entry !== null && typeof entry === "object") {
              collected.push({
                ...entry,
                contributionId: def.id,
                owner: def.owner,
              });
            } else {
              // A primitive contribution cannot carry the provenance stamp, so it is stored verbatim.
              collected.push(entry);
            }
          }
        }
      } catch (err) {
        reportContributionThrew(def.id, err);
      }
    }
    const current = store.getSnapshot().find((e) => e.id === slot);
    if (current && entriesUnchanged(current.entries, collected)) return;
    // After the guard, so one record is one entry set that genuinely moved.
    budget.record();
    store.update(slot, { entries: collected });
    // update() returns early on an unknown id, so the first write registers.
    if (!current) store.register({ id: slot, entries: collected });
  }, [contribs, topicValues, slot, store, budget, client]);

  return null;
}

/**
 * A contribution threw, which is an Uplink author's bug and must never be
 * silent. Falls back to `console.error` without a host, because the sdk's
 * `logger` throws when none is installed.
 */
function reportContributionThrew(id: string, err: unknown): void {
  const error = err instanceof Error ? err : new Error(String(err));
  const message = `Contribution "${id}" threw; skipped`;
  if (hasHost()) logger.error(message, error);
  else console.error(message, error);
}

export function ContributionsProvider({
  children,
}: {
  children?: ReactNode;
}): ReactElement {
  return (
    <ContributionsPanelStore.Provider>
      <ContributionsAggregation>{children}</ContributionsAggregation>
    </ContributionsPanelStore.Provider>
  );
}

/*
 * The framework-universal segments (`COMPONENT_SLOT_SEGMENTS`, shared with the
 * read half) are aggregated for EVERY widget on top of what it declared, so a
 * component owning one gets its contributions with nothing written by the
 * host. Only something every widget has belongs here; any other slot is
 * declared by the widget that hosts it.
 */
function ContributionsAggregation({ children }: { children?: ReactNode }) {
  const meta = useWidgetMeta();
  const store = ContributionsPanelStore.useStore();
  const slots = useMemo(() => {
    const declared = meta?.contributionSlots ?? [];
    if (!meta) return declared;
    const merged = [...declared];
    for (const segment of COMPONENT_SLOT_SEGMENTS) {
      const slot = `${meta.componentId}.${segment}`;
      if (!merged.includes(slot as never)) merged.push(slot as never);
    }
    return merged;
  }, [meta]);

  if (!store) return <>{children}</>;

  return (
    <>
      {slots.map((slot) => (
        <SlotAggregator key={slot} slot={slot} store={store} />
      ))}
      {children}
    </>
  );
}

export { useContributions, useContributionsBySlotId };
