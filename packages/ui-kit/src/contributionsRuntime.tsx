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
  type ContributionSlotEntry,
  ContributionsPanelStore,
  useContributions,
  useContributionsBySlotId,
} from "./contributionsRead";
import type { Store } from "./store/createStore";
import { useWidgetMeta } from "./WidgetMetaContext";

// ---------------------------------------------------------------------------
// The contribution WRITE seam: the per-frame aggregation pipeline that pulls
// each contribution's telemetry deps and fans the computed entries into the
// per-widget `ContributionsPanelStore`. It lives in core (not the ui-kit design
// floor) because it needs sitrep-client VALUES (`useTelemetryClientOptional`,
// `activateProcessor`, ...) and a core-side `PerfBudget`. The READ half (the
// store definition and the `useContributions` hooks) is spine-free and lives in
// `@ksp-gonogo/ui-kit`; both halves share the one `ContributionsPanelStore`
// imported above. The read hooks are re-exported at the bottom so
// `@ksp-gonogo/core` importers are byte-identical.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Per-slot PerfBudget (CLAUDE.md: any sample-fanning wrapper registers one).
// Slot ids are open-ended (third-party Uplinks declare their own), so a
// single module-scope constant doesn't fit the existing per-source pattern;
// instead one budget is lazily created and cached per slot id the first time
// that slot is aggregated. Each still self-registers into PerfBudget's own
// global registry (its constructor does that), so the dashboard's "Perf
// Budgets" widget picks every one of them up automatically.
// ---------------------------------------------------------------------------
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

// Stable empty snapshot for the no-`TelemetryProvider` case (a bare widget
// or a test rendered without one). `useSyncExternalStore` requires a
// referentially stable value between calls that haven't genuinely changed,
// a fresh `{}` literal on every call would make React see a "changed"
// snapshot on every render and error with "getSnapshot should be cached".
const EMPTY_TOPIC_VALUES: Readonly<Record<string, unknown>> = Object.freeze({});

// useSyncExternalStore requires a referentially-stable snapshot between
// changes, so the registry's per-slot array is memoised the same way
// AugmentSlot.tsx's getAugmentsForSlotCached is.
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

/** Element-wise reference equality: true when every entry is the SAME value as before. */
function entriesUnchanged(
  a: readonly unknown[],
  b: readonly unknown[],
): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

/**
 * One slot's aggregation pipeline: bulk-reads the union of every gated-in
 * contribution's `deps` once per Sitrep frame, calls each contribution's
 * `compute()` in a plain loop (no hooks, no Rules-of-Hooks problem: the
 * registered set may change freely at runtime), isolates a throwing
 * contribution with try/catch, and writes the aggregated array into the
 * per-widget store under this slot's key.
 *
 * Isolated into its own component (mirrors AugmentSlot.tsx's AugmentEntry)
 * so each slot's own hooks have a stable position regardless of how many
 * sibling slots the widget declares.
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
    // Every domain a contribution names via `requires` needs its own
    // `<domain>.available` subscription too, NOT just a `client.getValue()`
    // read: `getValue` returns whatever the store currently holds, but the
    // stub/production transport alike only ever DELIVERS a sample for a
    // topic something has subscribed to (see `StubTransport.emit`'s own
    // subscription gate). Without this, `requires` silently depends on
    // some UNRELATED widget elsewhere on the dashboard happening to
    // already subscribe to that same `.available` topic (true almost
    // always in the live app, since a domain-gated widget's own
    // `RequiresGuard` does exactly that) and evaluates to "domain absent"
    // whenever this slot's own widget is the only thing on screen, e.g.
    // ShipMap hosting another Uplink's part-meters contribution with no
    // other widget from that Uplink mounted. Found rendering the ShipMap
    // self-contribution arc (spec §13.4) in isolation.
    for (const c of contribs) {
      for (const d of c.deps ?? []) {
        if (typeof d === "string") topics.add(d as TopicId);
        // A reading dep names the same wire topic a bare id does; only what the
        // consumer is HANDED differs, so it subscribes exactly the same way.
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

  // Activate every Processor this slot's contributions dep on, for the slot's
  // lifetime. Processor freshness rides the same `subscribeFrame` the Topic
  // reads already use (the evaluator evaluates on that frame boundary), so no
  // separate per-processor subscription is needed in `subscribe`.
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
      // Resolved to the wire topics the server understands, exactly as
      // `useStream` and the processor evaluator do. A derived channel is
      // computed on this side and the server has never heard of its topic, so
      // asking for the literal dep left the channel's inputs unsubscribed and
      // the contribution reading `undefined` forever.
      const unsubscribeInputs: Array<() => void> = [];
      for (const topic of unionDeps.topics) {
        for (const inputTopic of telemetryStore.resolveSubscriptionTopics(
          topic,
        )) {
          unsubscribeInputs.push(client.subscribe(inputTopic, () => {}));
        }
      }
      const unsubscribeFrame = telemetryStore.subscribeFrame(() => {
        // Force this slot's Processor deps fresh for the just-begun frame
        // BEFORE notifying React: a slot's own frame listener can fire before
        // the evaluator's shared one (the evaluator connects on the parent
        // provider's effect, after this child already subscribed), which would
        // otherwise cache a pre-evaluation snapshot for the frame. Idempotent
        // and skipped entirely for a slot with no Processor deps.
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

  // Caches the last-built topic-values object keyed on the `FrameToken` it
  // was built from. `telemetryStore.currentFrame()` returns the SAME token
  // object for the whole life of a frame (only `beginFrame()` mints a new
  // one), so re-reading within one frame (e.g. React's own render-vs-commit
  // tearing check inside `useSyncExternalStore`) hits the cache and returns
  // the identical object; only a genuine new frame rebuilds it. Without
  // this, `getSnapshot` would return a fresh object on every call and
  // trigger React's "the result of getSnapshot should be cached" loop.
  const topicCacheRef = useRef<{
    token: FrameToken;
    values: Record<string, unknown>;
  } | null>(null);

  const getSnapshot = useCallback((): Record<string, unknown> => {
    if (!telemetryStore) return EMPTY_TOPIC_VALUES;
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
    topicCacheRef.current = { token, values };
    return values;
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
        const result = def.compute(topicValues as never);
        if (result) {
          for (const entry of result) {
            if (entry !== null && typeof entry === "object") {
              collected.push({
                ...entry,
                contributionId: def.id,
                owner: def.owner,
              });
            } else {
              // A PRIMITIVE contribution (a `filters` segment's search terms):
              // stored verbatim. It cannot carry the provenance stamp, and the
              // segment's consumer (`FilterList`) reads plain values, not rows.
              collected.push(entry);
            }
          }
        }
      } catch (err) {
        reportContributionThrew(def.id, err);
      }
    }
    budget.record();
    const current = store.getSnapshot().find((e) => e.id === slot);
    if (current && entriesUnchanged(current.entries, collected)) return;
    store.update(slot, { entries: collected });
    // register() is a no-op-safe upsert on first write: update() alone
    // returns early on an unknown id, so seed the entry once.
    if (!current) store.register({ id: slot, entries: collected });
  }, [contribs, topicValues, slot, store, budget, client]);

  return null;
}

/**
 * A contribution threw, which is an Uplink author's bug and must never be silent.
 *
 * Through the host's logger when there is a host, so it reaches Axiom and the
 * shared `exportLogs()` buffer, and through `console.error` when there is not. The
 * fallback is not belt-and-braces: the sdk's `logger` is a Proxy over
 * `getHost().logger` and THROWS when nothing is installed, so an unguarded call
 * would turn one broken `compute` into a torn-down render tree, and would do it in
 * exactly the setting where a bare `render` is likeliest, a widget test.
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

// Framework-universal segments aggregated for EVERY widget, on top of whatever
// it declared, so a component that owns one of these slots (a mounted
// `FilterList`, a badge) gets its contributions without the host widget writing
// anything. `badges` is the original auto-slot (spec §13.2); `filters` is the
// component-extension-slot generalisation, completed the same `${componentId}.
// ${segment}` way. A widget that also lists one of these in `contributionSlots`
// is harmlessly deduped below.
const FRAMEWORK_SEGMENTS = ["badges", "filters"] as const;

function ContributionsAggregation({ children }: { children?: ReactNode }) {
  const meta = useWidgetMeta();
  const store = ContributionsPanelStore.useStore();
  const slots = useMemo(() => {
    const declared = meta?.contributionSlots ?? [];
    if (!meta) return declared;
    const merged = [...declared];
    for (const segment of FRAMEWORK_SEGMENTS) {
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

// The READ hooks are this package's too, one module over. Re-exported from here
// so `@ksp-gonogo/core`'s barrel and every existing importer keep resolving
// `useContributions` / `useContributionsBySlotId` through the runtime module
// unchanged.
export { useContributions, useContributionsBySlotId };
