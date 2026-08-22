import type {
  AugmentDefinition,
  NamespacedAugmentSettings,
  SlotProps,
} from "@ksp-gonogo/sitrep-sdk";
import { hasHost, logger } from "@ksp-gonogo/sitrep-sdk";

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
// Uplink can import. It is spine-free: it sources `sitrep-sdk` types, the react
// types, this package's own `UplinkClientIdentity`, and the sdk's `logger` /
// `hasHost` for the retired-slot diagnostic below. `@ksp-gonogo/core`
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
// down. An undeclared segment falls back to the same loose record `SlotProps`
// uses. Declare a line here (or via `declare module "@ksp-gonogo/core"`) when
// an augment segment lands.
//
// The two framework-universal augment segments below are `Panel`'s (see
// `FRAMEWORK_AUGMENT_SEGMENTS` in Panel.tsx), and they are PROPLESS by
// construction. A universal segment can only pass what the framework knows,
// and the framework knows nothing about any one widget's state; a segment
// whose props were `Record<string, unknown>` would be a slot whose contract is
// "some object", which is not a contract. What a widget knows and an augment
// wants reaches it through `WidgetScopeContext` instead, where the widget
// names the type.
// ---------------------------------------------------------------------------
export interface AugmentSegmentRegistry {
  /**
   * Body sections appended below everything the host widget renders. The
   * augment reads its own Topics and needs nothing from the host.
   */
  sections: Record<string, never>;
  /**
   * Header controls, rendered in the panel header's aside alongside the
   * widget's badges and status. Same position the universal `badges`
   * contribution lands in.
   */
  actions: Record<string, never>;
}

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
/**
 * One augment's settings block, namespaced for the host panel.
 *
 * The sdk's, re-exported, same as `AugmentSettingField` above and for the same
 * reason: it is a shape over that type, and the fog-reveal registry in the sdk
 * returns it too. Two published declarations of one author-facing type drift
 * without anything saying so.
 */
export type {
  AugmentSettingField,
  NamespacedAugmentSettings,
} from "@ksp-gonogo/sitrep-sdk";

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

/**
 * Slot ids this repo has retired, mapped to the id that replaced them.
 *
 * A renamed slot is the one registry mistake that costs nothing at registration
 * and everything at render: `registerAugment` accepts any string, and
 * `getAugmentsForSlot` matches on equality, so an augment bound to a retired id
 * is stored, never matched, and draws nothing, with no error anywhere. A
 * third-party Uplink pinned to the old name would look installed and healthy
 * while contributing no pixels.
 *
 * There is deliberately no general unknown-slot check to lean on here: slot ids
 * are a compile-time declaration-merging seam (`SlotRegistry`) declared across
 * many packages, so at runtime this registry sees only strings and cannot know
 * which are real. It CAN know which ones we ourselves retired, which is the case
 * that actually breaks a working Uplink, so that is what this table carries.
 *
 * Entries stay for as long as an Uplink built against the old name might still
 * be installed. The retired id is not accepted, only explained: forwarding it to
 * the new slot would keep a dead name silently load-bearing.
 */
export const RETIRED_SLOT_IDS: Readonly<Record<string, string>> = {
  "distance-to-target.camera": "targeting.camera",
  "distance-to-target.overlay": "targeting.overlay",
};

/**
 * An augment named a retired slot, so it would render nothing. Reported through
 * the host's logger when there is a host, so it reaches Axiom and the shared
 * `exportLogs()` buffer, and through `console.error` when there is not: the
 * sdk's `logger` is a Proxy over `getHost().logger` and THROWS when nothing is
 * installed, which would turn a stale slot name into a torn-down module load in
 * exactly the setting where a bare registration is likeliest, an Uplink's test.
 */
function reportIfSlotRetired(
  def: Pick<AugmentDefinition<string>, "id" | "augments" | "owner">,
): void {
  const replacement = RETIRED_SLOT_IDS[def.augments];
  if (!replacement) return;
  const owner = def.owner ? `${def.owner.name} (${def.owner.id})` : "unknown";
  const message =
    `Augment "${def.id}" binds retired slot "${def.augments}", ` +
    `renamed to "${replacement}"; it will render nothing until updated. ` +
    `Registered by Uplink: ${owner}`;
  if (hasHost()) logger.error(message);
  else console.error(message);
}

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
  reportIfSlotRetired(def);
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
