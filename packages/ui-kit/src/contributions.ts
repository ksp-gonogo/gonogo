import type { TopicId, TopicPayload } from "@ksp-gonogo/sitrep-sdk";

// ---------------------------------------------------------------------------
// The contribution TYPE surface (contribution-slots-spec.md §3-4): the
// declaration-merge registries, the entry-shape resolution, and the read
// entry type. These live in the published design floor (ui-kit) so the
// contribution READ hooks (`contributionsRead.tsx`) and `FilterList` can be
// reachable by third-party Uplinks without importing core.
//
// The REGISTRATION half (`ContributionDefinition` with its sitrep-client `Dep[]`
// deps, `registerContribution`, and the live registry) stays in
// `@ksp-gonogo/core`: it needs a spine type and is the write path, not the read
// path. `@ksp-gonogo/core` re-exports every type below, so a `declare module
// "@ksp-gonogo/core" { interface ContributionRegistry ... }` /
// `ComponentSlotRegistry` augmentation still merges (verified by a test-d and
// the in-tree augmentations), and every `@ksp-gonogo/core` importer is unchanged.
// ---------------------------------------------------------------------------

/**
 * The provenance identity a read contribution entry carries in `owner`. The
 * DATA subset of core's `UplinkClientHandle` (`defineUplinkClient`): id, version
 * and human name. The read path only ever surfaces provenance (keys, blame,
 * health/search tags), never the handle's registration methods, so the read
 * seam types `owner` against this floor-level identity rather than the full,
 * `Dep`-referencing handle (which stays in core). A full `UplinkClientHandle` is
 * structurally an `UplinkClientIdentity`, so the aggregation stamps one straight
 * in.
 */
export interface UplinkClientIdentity {
  id: string;
  version: string;
  name: string;
}

/**
 * Global slot -> {ctx, entry, topics} registry, extended via declaration
 * merging exactly like SlotRegistry (augments.ts). `topics` is the union of
 * Topic ids a contribution bound to this slot may read; omit it for a slot
 * that needs no topics.
 */
// biome-ignore lint/suspicious/noEmptyInterface: declaration-merging seam, mirrors SlotRegistry
export interface ContributionRegistry {}

/** Union of every declared in-tree contribution slot id. `never` until a package merges one in. */
export type ContributionSlotId = keyof ContributionRegistry;

// ---------------------------------------------------------------------------
// Segment-keyed registry for HOST-INVARIANT component slot types.
//
// A reusable component (mostly ui-kit / `@ksp-gonogo/ui`) cannot write the
// full slot literal `${componentId}.${segment}`, because it does not know
// which widget it is mounted in. So it writes only the SEGMENT ("filters") and
// the primitives complete `${componentId}.${segment}` from `useWidgetMeta()`
// at runtime. This registry maps a SEGMENT -> the entry type its contributions
// carry: the host-invariant sibling of `ContributionRegistry`'s full-id map.
//
// The framework owns the universal `filters` segment here, once, forever, so
// every component / widget / contributor writes nothing. A component inventing
// a NOVEL host-invariant segment declares its one line co-located at the
// bottom of its own file, the same way a widget's other module-load
// self-registrations sit alongside its `registerComponent` call:
//
//   declare module "@ksp-gonogo/core" {
//     interface ComponentSlotRegistry { "my-segment": MyEntry }
//   }
//
// OVERRIDE HATCH (documented, unused in this change): a widget that needs a
// HOST-SPECIFIC entry type for one completed key: the rare component slot whose
// entry genuinely depends on the host: overrides the host-invariant default by
// declaring that full key in `ContributionRegistry` in its OWN package. The
// full-id branch of `ContributionEntry` below wins over the segment branch, so
// the override is cleanly cordoned, never on the common path.
// ---------------------------------------------------------------------------

export interface ComponentSlotRegistry {
  /**
   * The framework-universal filter segment: a contribution is a pre-filled
   * SEARCH TERM (a plain string) that `FilterList` shows as a toggle. Host-
   * invariant, the same string means the same thing in any widget.
   */
  filters: string;
}

/** Every segment declared as a host-invariant component slot. */
export type ComponentSlotSegment = keyof ComponentSlotRegistry;

/** The trailing segment of a completed slot id: `"resource-ops.filters"` -> `"filters"`. */
type SegmentOf<S extends string> = S extends `${string}.${infer Rest}`
  ? Rest extends `${string}.${string}`
    ? SegmentOf<Rest>
    : Rest
  : never;

/**
 * The entry shape a slot renders. Resolution order:
 *  1. a full slot id declared in {@link ContributionRegistry} (host-specific,
 *     the override hatch and every existing widget-led slot) wins outright
 *  2. else the slot's trailing SEGMENT in {@link ComponentSlotRegistry} (the
 *     host-invariant component-slot case, e.g. `*.filters` -> `string`)
 *  3. else a loose record, the out-of-repo / undeclared fallback.
 */
export type ContributionEntry<S extends string> =
  S extends keyof ContributionRegistry
    ? ContributionRegistry[S] extends { entry: infer E }
      ? E
      : Record<string, unknown>
    : [SegmentOf<S>] extends [ComponentSlotSegment]
      ? [SegmentOf<S>] extends [never]
        ? Record<string, unknown>
        : ComponentSlotRegistry[SegmentOf<S>]
      : Record<string, unknown>;

type DeclaredTopicUnion<S extends string> = S extends keyof ContributionRegistry
  ? ContributionRegistry[S] extends { topics: infer T extends string }
    ? T
    : never
  : never;

/**
 * The typed argument a slot's contributions receive: current values of every
 * declared topic, keyed by topic id. The `& Record<string, unknown>` tail keeps
 * a Processor dep readable by its stamped id (`topics[processor.id]`, typed
 * `unknown`) while the mapped head preserves each declared Topic's precise
 * payload type (intersection: a declared topic key keeps `TopicPayload<K>`,
 * since `X & unknown = X`).
 */
export type ContributionTopics<S extends string> = {
  readonly [K in DeclaredTopicUnion<S> & TopicId]: TopicPayload<K> | undefined;
} & Record<string, unknown>;

/** One rendered entry, tagged with provenance for keys and blame. */
export type Contributed<E> = E & {
  readonly contributionId: string;
  readonly owner?: UplinkClientIdentity;
};
