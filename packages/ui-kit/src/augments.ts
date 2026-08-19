import type {
  AugmentDefinition,
  AugmentSettingField,
  SlotProps,
} from "@ksp-gonogo/sitrep-sdk";
import type { ComponentType } from "react";

// ---------------------------------------------------------------------------
// The augment model (Uplink architecture spec §4)
//
// Core (or any) widgets expose named **augment slots**; any Uplink contributes
// a component into a slot using ONLY its own Topics; the **host composes**. Two
// mutually-unaware mods binding the same slot both render, ordered by priority,
// neither references the other, honouring "no Uplink talks to another."
//
// This registry lives in the published design floor (`@ksp-gonogo/ui-kit`) so
// contributions AND augments both resolve from the one package a third-party
// Uplink can import. It is spine-free: it sources only `sitrep-sdk` TYPES, the
// react types, and this package's own `UplinkClientIdentity`. `@ksp-gonogo/core`
// re-exports every symbol here, so a `declare module "@ksp-gonogo/core"`
// augmentation of `SlotRegistry` still merges and every existing core importer
// is byte-identical. The frame-batched evaluator that consumes availability
// (`SlotAggregator` / `ContributionsProvider`) stays spine-side in core BY
// DESIGN (spec §14); it never imports from here.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Slot-id typing: declaration-merging seam (spec §4.6)
//
// `TopicId` is generated centrally from the C# contract, but slot ids are
// declared across many TS packages, so a `SlotId` union + per-slot props type
// can't be generated the same way. The Phase-0 answer (spec §4.6 "likely a
// HYBRID, user leans toward declaration-merging as the base") is module
// augmentation: each in-tree package that OWNS a slot augments this global
// `SlotRegistry` interface, mapping its slot id → the props that slot passes
// down to its augments. That gives full compile-time safety across all in-tree
// Uplinks NOW, which is the whole current rollout.
//
//   // in @ksp-gonogo/components, next to registerComponent('power-systems'):
//   declare module "@ksp-gonogo/core" {
//     interface SlotRegistry {
//       "power-systems.sections": { instanceId: string };
//     }
//   }
//
// Once merged, `registerAugment({ augments: "power-systems.sections", ... })`
// types its `component` against `{ instanceId: string }`, and
// `<AugmentSlot name="power-systems.sections" props={{ instanceId }} />`
// requires exactly those props. The augmentation targets `@ksp-gonogo/core`
// (which re-exports this interface); declaration merging still lands on the
// shared symbol, so `AugmentSlot` here reads the merged registry.
//
// The out-of-repo case (a third-party Uplink not in this tsconfig, which cannot
// merge into `SlotRegistry`) is deliberately NOT solved here, that is Phase 7
// (a local type-gen script / runtime-validated string slots). This module only
// provides the reserved seam and a graceful loose-typed fallback so an unknown
// slot id still compiles (as `Record<string, unknown>` props) rather than
// erroring: matching the spec's hybrid (c) fallback.
// ---------------------------------------------------------------------------

// The seam itself is NOT declared here. It is `@ksp-gonogo/sitrep-sdk`'s,
// re-exported, and a re-export carries the augmentation: a `declare module
// "@ksp-gonogo/core"` merge lands on the aliased declaration, so every in-repo
// augmentation keeps working unchanged and now lands on the SAME interface an
// Uplink's `declare module "@ksp-gonogo/sitrep-sdk"` merge does.
//
// Both were declared, in both packages, until now. That is the one divergence
// shape that cannot fail loudly: an Uplink merging a slot id into the sdk's
// registry and a widget merging one into ui-kit's are both correct-looking, both
// compile, and landed on two different interfaces. `AugmentSlot` read ui-kit's
// and so never saw an Uplink's slot ids; `SlotProps` off the sdk never saw a
// widget's. Neither side could observe the other's absence.
export type {
  SlotId,
  SlotProps,
  SlotRegistry,
} from "@ksp-gonogo/sitrep-sdk";

// ---------------------------------------------------------------------------
// Segment-keyed augment-props seam, the parallel of `SlotRegistry` for the
// component-led `<AugmentSlot segment>` form. A reusable component writes only
// the SEGMENT and `<AugmentSlot>` completes `${componentId}.${segment}` from
// `useWidgetMeta()`; this maps a SEGMENT -> the props that augment slot passes
// down. Empty for v1: only the CONTRIBUTION `filters` segment is exercised, so
// no augment segment needs precise props yet, and an undeclared segment falls
// back to the same loose record `SlotProps` uses. Declare a line here (or via
// `declare module "@ksp-gonogo/core"`) if and when an augment segment lands.
// ---------------------------------------------------------------------------
// biome-ignore lint/suspicious/noEmptyInterface: parallel segment seam to SlotRegistry, empty until an augment segment lands
export interface AugmentSegmentRegistry {}

/**
 * The props a component-led augment SEGMENT passes to its augments, resolved
 * from {@link AugmentSegmentRegistry}; loose fallback until a segment is
 * declared, mirroring {@link SlotProps}.
 */
export type AugmentSegmentProps<Seg extends string> =
  Seg extends keyof AugmentSegmentRegistry
    ? AugmentSegmentRegistry[Seg]
    : Record<string, unknown>;

// ---------------------------------------------------------------------------
// Augment settings (spec §4.7)
// ---------------------------------------------------------------------------

/**
 * A single per-instance setting an augment contributes. Merged (namespaced by
 * augment id) into the host widget's settings panel; see {@link getAugmentSettings}.
 *
 * The sdk's, re-exported. It was an identical copy here, and two published
 * declarations of one author-facing type drift without anything saying so.
 */
export type { AugmentSettingField } from "@ksp-gonogo/sitrep-sdk";

/**
 * One augment's settings block, namespaced for the host panel. `namespace` is
 * the augment id; the host stores each field under `<namespace>.<key>` in the
 * widget instance config so two augments' identically-named settings never
 * collide, and an absent Uplink contributes nothing.
 */
export interface NamespacedAugmentSettings {
  augmentId: string;
  namespace: string;
  fields: readonly AugmentSettingField[];
}

// ---------------------------------------------------------------------------
// Augment definition + registration (spec §4.2)
// ---------------------------------------------------------------------------

/**
 * Registration descriptor for an augment: a component bound into another
 * widget's slot. `S` is inferred from `augments`, so `component` is typed
 * against that slot's {@link SlotProps} (spec §4.4: slot-parameterised augments).
 *
 * The sdk's, re-exported. Both packages declared it with the same nine fields,
 * and two published declarations of one author-facing type is the shape that
 * drifts with nothing to say so: an Uplink typing an augment against the sdk's
 * and a widget typing one against ui-kit's would both compile forever while
 * meaning different things. The long-form field documentation stays on the sdk's
 * copy, which is the one an author reads.
 */
export type { AugmentDefinition } from "@ksp-gonogo/sitrep-sdk";

// Stored erased to the loose slot type so the registry can hold augments for
// any slot; `S` is checked at the `registerAugment` call site.
export type AnyAugment = AugmentDefinition<string>;

// Registration order is captured so ties in `priority` sort deterministically.
const augments = new Map<string, { def: AnyAugment; order: number }>();
let registrationCounter = 0;

const augmentListeners = new Set<() => void>();
function notifyAugmentChange(): void {
  for (const cb of augmentListeners) cb();
}

/** Subscribe to augment registry mutations (register / clear). */
export function onAugmentsChange(cb: () => void): () => void {
  augmentListeners.add(cb);
  return () => {
    augmentListeners.delete(cb);
  };
}

/**
 * Register an augment into a widget's slot (spec §4.2). Call at module load,
 * exactly like `registerComponent`. Multiple augments may target one slot; they
 * compose, ordered by `priority` (spec §4.8). `component` is typed against the
 * target slot's props via the {@link SlotRegistry} declaration-merging seam.
 */
export function registerAugment<S extends string>(
  def: AugmentDefinition<S>,
): void {
  augments.set(def.id, {
    // Erased through `unknown`: with the slot registry merged, `SlotProps<S>` is
    // a real props type rather than the loose bag it collapsed to while ui-kit
    // carried its own permanently-empty copy of the seam, so `ComponentType` is
    // no longer bivariantly comparable to the erased form. The erasure itself is
    // the point (the registry holds augments for every slot); `S` is checked at
    // this call site, which is the only place it can be.
    def: def as unknown as AnyAugment,
    order: registrationCounter++,
  });
  notifyAugmentChange();
}

/**
 * Every augment bound to `slotName`, ordered for rendering: ascending
 * `priority` (default 0), ties in registration order. Presence-gating
 * (`requires`) is applied at RENDER time by {@link AugmentSlot}, not here, this
 * returns all registered augments for the slot regardless of Domain availability.
 */
export function getAugmentsForSlot(slotName: string): AnyAugment[] {
  return Array.from(augments.values())
    .filter((entry) => entry.def.augments === slotName)
    .sort((a, b) => {
      const pa = a.def.priority ?? 0;
      const pb = b.def.priority ?? 0;
      if (pa !== pb) return pa - pb;
      return a.order - b.order;
    })
    .map((entry) => entry.def);
}

/** Every registered augment, unordered. */
export function getAugments(): AnyAugment[] {
  return Array.from(augments.values()).map((entry) => entry.def);
}

/**
 * The namespaced settings blocks contributed by every augment bound to
 * `slotName` that declares `settings` (spec §4.7). The host widget's settings
 * panel composes these after its own stock settings; each block's `namespace`
 * (the augment id) scopes its fields in the per-instance config. Ordered the
 * same way the augments render. An absent Uplink contributes no block.
 */
export function getAugmentSettings(
  slotName: string,
): NamespacedAugmentSettings[] {
  return getAugmentsForSlot(slotName)
    .filter((def) => def.settings && def.settings.length > 0)
    .map((def) => ({
      augmentId: def.id,
      namespace: def.id,
      fields: def.settings ?? [],
    }));
}

/** For use in tests only, resets the augment registry to empty. */
export function clearAugments(): void {
  augments.clear();
  registrationCounter = 0;
  notifyAugmentChange();
}
