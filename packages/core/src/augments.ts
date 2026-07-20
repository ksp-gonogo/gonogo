import { logger } from "@ksp-gonogo/logger";
import type { TopicId } from "@ksp-gonogo/sitrep-sdk";
import type { ComponentType } from "react";

// ---------------------------------------------------------------------------
// The augment model (Uplink architecture spec §4)
//
// Core (or any) widgets expose named **augment slots**; any Uplink contributes
// a component into a slot using ONLY its own Topics; the **host composes**. Two
// mutually-unaware mods binding the same slot both render, ordered by priority —
// neither references the other, honouring "no Uplink talks to another."
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Slot-id typing — declaration-merging seam (spec §4.6)
//
// `TopicId` is generated centrally from the C# contract, but slot ids are
// declared across many TS packages, so a `SlotId` union + per-slot props type
// can't be generated the same way. The Phase-0 answer (spec §4.6 "likely a
// HYBRID, user leans toward declaration-merging as the base") is module
// augmentation: each in-tree package that OWNS a slot augments this global
// `SlotRegistry` interface, mapping its slot id → the props that slot passes
// down to its augments. That gives full compile-time safety across all in-tree
// Uplinks NOW — which is the whole current rollout.
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
// requires exactly those props.
//
// The out-of-repo case (a third-party Uplink not in this tsconfig, which cannot
// merge into `SlotRegistry`) is deliberately NOT solved here — that is Phase 7
// (a local type-gen script / runtime-validated string slots). This module only
// provides the reserved seam and a graceful loose-typed fallback so an unknown
// slot id still compiles (as `Record<string, unknown>` props) rather than
// erroring — matching the spec's hybrid (c) fallback.
// ---------------------------------------------------------------------------

/**
 * Global slot → props-type registry, extended via declaration merging. Empty in
 * core; each package that exposes a slot augments it. See the module comment.
 */
// biome-ignore lint/suspicious/noEmptyInterface: intentional declaration-merging seam (spec §4.6)
export interface SlotRegistry {}

/** Union of every declared in-tree slot id. `never` until a package merges one in. */
export type SlotId = keyof SlotRegistry;

/**
 * The props a slot passes to its augments. Typed precisely for a slot declared
 * in {@link SlotRegistry}; falls back to `Record<string, unknown>` for a slot
 * id not (yet) in the registry — the out-of-repo/loose case (spec §4.6 (c)).
 */
export type SlotProps<S extends string> = S extends keyof SlotRegistry
  ? SlotRegistry[S]
  : Record<string, unknown>;

// ---------------------------------------------------------------------------
// Augment settings (spec §4.7)
// ---------------------------------------------------------------------------

/**
 * A single per-instance setting an augment contributes. Merged (namespaced by
 * augment id) into the host widget's settings panel — see {@link getAugmentSettings}.
 */
export interface AugmentSettingField {
  key: string;
  type: "boolean" | "text" | "number";
  label?: string;
  default?: boolean | string | number;
}

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
 * Registration descriptor for an augment — a component bound into another
 * widget's slot. `S` is inferred from `augments`, so `component` is typed
 * against that slot's {@link SlotProps} (spec §4.4: slot-parameterised augments).
 */
export interface AugmentDefinition<S extends string = string> {
  /**
   * Stable id, unique per augment. Used as the React key, for de-duplication on
   * re-registration, and as the settings namespace (spec §4.7). Required — an
   * augment has no identity to namespace its settings without it.
   */
  id: string;
  /** The slot this augment binds into — must match a base widget's `augmentSlots` entry. */
  augments: S;
  /**
   * The augment's own component, rendered inside the slot and receiving the
   * slot's props (spec §4.4). Lives in the augmenting Uplink's package.
   */
  component: ComponentType<SlotProps<S>>;
  /** This augment's OWN Topics only (spec §4.2) — never another Uplink's. */
  channels?: readonly TopicId[];
  /**
   * Domain presence gate (spec §4.2): the augment renders only while the
   * Domain's `<requires>.available` Topic is live. When the augmenting Uplink
   * is absent, that Topic never arrives → the augment is not rendered and the
   * slot composes without it, with zero impact on users who don't run it.
   */
  requires?: string;
  /**
   * Ordering within a slot. Augments render in ASCENDING priority order, so the
   * highest-priority augment renders LAST — for overlay slots (spec §4.8) that
   * puts it on top (z-order); for section slots it appears after the others.
   * Ties preserve registration order (stable sort). Defaults to 0.
   */
  priority?: number;
  /**
   * Per-instance settings merged into the host widget's settings panel,
   * namespaced by this augment's id (spec §4.7).
   */
  settings?: readonly AugmentSettingField[];
  /**
   * Declares that, while this augment's Domain is LIVE, the host's own
   * default/replaceable surface for the slot it targets is suppressed
   * outright — a REPLACE, not an overlay. This field itself is static and
   * can be read straight off the registry (e.g. via
   * {@link getAugmentsForSlot}), but the SUPPRESSION DECISION must NOT stop
   * there: registration alone only proves the augment's client package was
   * bundled, not that its Domain is actually live (a bundled client
   * package registers its augments unconditionally at import time, whether
   * or not the corresponding mod is running). A host must gate this field
   * by the same Domain-presence signal `<AugmentSlot>` itself uses before
   * ever rendering the augment's component — see
   * {@link useAugmentAvailable} — or every user without that Uplink
   * installed loses the host's default surface with nothing to replace it
   * (regression fixed 2026-07-20). Independent of any other augment's
   * `settings`/per-instance visibility, and independent of whether THIS
   * augment currently has anything to draw. A host slot that has no such
   * default surface can ignore the field entirely — it's an opt-in
   * contract between a slot and the augments that choose to use it, not a
   * universal one every slot must interpret (spec:
   * local_docs/spec-mapview-stackable-layers.md).
   */
  suppressesVanillaBase?: boolean;
}

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
  logger.info(`REGISTERED augment ${def.id} → ${def.augments}`);
  augments.set(def.id, {
    def: def as AnyAugment,
    order: registrationCounter++,
  });
  notifyAugmentChange();
}

/**
 * Every augment bound to `slotName`, ordered for rendering: ascending
 * `priority` (default 0), ties in registration order. Presence-gating
 * (`requires`) is applied at RENDER time by {@link AugmentSlot}, not here — this
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

/** For use in tests only — resets the augment registry to empty. */
export function clearAugments(): void {
  augments.clear();
  registrationCounter = 0;
  notifyAugmentChange();
}
