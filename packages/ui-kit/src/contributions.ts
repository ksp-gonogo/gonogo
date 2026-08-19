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

// ---------------------------------------------------------------------------
// The declaration-merge seam itself is NOT declared here. It is
// `@ksp-gonogo/sitrep-sdk`'s, re-exported.
//
// It used to be declared in both packages, and that is the one divergence shape
// that cannot fail loudly. An Uplink writes `declare module
// "@ksp-gonogo/sitrep-sdk" { interface ContributionRegistry ... }` and an
// in-repo widget writes `declare module "@ksp-gonogo/core" { ... }`; both are
// correct-looking, both compile, and they landed on two different interfaces, so
// neither could see the other's slots and nothing anywhere said so.
//
// A re-export carries the augmentation: `declare module "@ksp-gonogo/core"`
// merges into the aliased declaration, so every in-repo merge keeps working
// unchanged and now lands on the same interface an Uplink's does. That is the
// whole point, and `contribution-registry-augmentation.test-d.ts` is what proves
// it rather than this comment.
//
// `ComponentSlotRegistry` and the three-branch `ContributionEntry` resolution
// moved WITH it, rather than the sdk's two-branch copy winning: deferring to the
// poorer shape would have silently dropped the host-invariant segment branch
// (`*.filters`) that every FilterList contribution rides on.
// ---------------------------------------------------------------------------

import type { ContributionRegistry } from "@ksp-gonogo/sitrep-sdk";

export type {
  ComponentSlotRegistry,
  ComponentSlotSegment,
  ContributionEntry,
  ContributionRegistry,
  ContributionSlotId,
} from "@ksp-gonogo/sitrep-sdk";

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
