// ---------------------------------------------------------------------------
// The contribution TYPE surface (contribution-slots-spec.md §3-4): the
// declaration-merge registries, the entry-shape resolution, the typed `topics`
// argument and the read entry type.
//
// None of it is DECLARED here any more. It is all `@ksp-gonogo/sitrep-sdk`'s,
// re-exported, and the reason is the one divergence shape that cannot fail
// loudly. An Uplink writes `declare module "@ksp-gonogo/sitrep-sdk" { interface
// ContributionRegistry ... }` and an in-repo widget writes `declare module
// "@ksp-gonogo/core" { ... }`; both are correct-looking, both compile, and while
// the seam was declared in two packages they landed on two different interfaces,
// so neither could see the other's slots and nothing anywhere said so.
//
// A re-export carries the augmentation: a `declare module` block merges into the
// aliased declaration, so every in-repo merge keeps working unchanged and lands
// on the same interface an Uplink's does. That is the whole point, and
// `contribution-registry-augmentation.test-d.ts` is what proves it rather than
// this comment.
//
// `ContributionTopics`, `Contributed` and `UplinkClientIdentity` were the last
// three still declared here, and they followed for a different reason: the
// contribution WRITE registry moved to the sdk, where it needs all three, and
// the sdk cannot import this package. They were derivable from sdk types alone
// (`ContributionRegistry`, `TopicId`, `TopicPayload`, three strings), so there
// was nothing to keep them up here for.
//
// The READ half is still ours: `contributionsRead.tsx`'s store and hooks, and
// `FilterList`. Only the types went down.
// ---------------------------------------------------------------------------

export type {
  ComponentSlotRegistry,
  ComponentSlotSegment,
  Contributed,
  ContributionEntry,
  ContributionRegistry,
  ContributionSlotId,
  ContributionTopics,
  UplinkClientIdentity,
} from "@ksp-gonogo/sitrep-sdk";
