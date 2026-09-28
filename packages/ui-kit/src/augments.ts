import type {
  AugmentDefinition,
  NamespacedAugmentSettings,
  SlotProps,
} from "@ksp-gonogo/sitrep-sdk";
import { hasHost, logger } from "@ksp-gonogo/sitrep-sdk";
import type { ComponentType } from "react";

/*
 * Widgets expose named augment slots, any Uplink contributes a component into a
 * slot using only its own Topics, and the host composes. Two mutually unaware
 * mods binding the same slot both render, ordered by priority.
 *
 * Slot ids are typed by declaration merging into `SlotRegistry`, which maps
 * a slot id to the props it passes down. An undeclared slot id still compiles.
 * The seam is the sdk's, re-exported, so a merge into either package lands on
 * the same interface; declaring it in both would split slot ids across two
 * interfaces with nothing failing.
 */
export type {
  SlotId,
  SlotProps,
  SlotRegistry,
} from "@ksp-gonogo/sitrep-sdk";

/**
 * Maps an augment SEGMENT to the props it passes down, for the component-led
 * `<AugmentSlot segment>` form, which completes `${componentId}.${segment}` from
 * `useWidgetMeta()`. The framework-universal segments are propless: a widget's
 * state reaches an augment through `WidgetScopeContext` instead.
 */
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

/** The props a component-led augment SEGMENT passes to its augments, resolved from {@link AugmentSegmentRegistry}. */
export type AugmentSegmentProps<Segment extends string> =
  Segment extends keyof AugmentSegmentRegistry
    ? AugmentSegmentRegistry[Segment]
    : never;

/*
 * `AugmentSettingField` is one per-instance setting an augment contributes to
 * the host widget's settings panel, namespaced by augment id;
 * `NamespacedAugmentSettings` is one augment's block of them.
 */
/**
 * Registration descriptor for an augment: a component bound into another
 * widget's slot. `S` is inferred from `augments`, so `component` is typed
 * against that slot's {@link SlotProps}.
 */
export type {
  AugmentDefinition,
  AugmentSettingField,
  NamespacedAugmentSettings,
} from "@ksp-gonogo/sitrep-sdk";

/*
 * The erased form the registry stores, so one map holds every slot's augments.
 * `SlotProps<string>` would resolve to `never` for an undeclared slot; `Slot` is
 * checked at the `registerAugment` call site instead.
 */
export type AnyAugment = Omit<AugmentDefinition<string>, "component"> & {
  component: ComponentType<Record<string, unknown>>;
};

/**
 * The registry lives on `globalThis` under a string key so every loaded copy of
 * this package (an Uplink that inlines ui-kit loads a second) shares one state.
 */
const AUGMENT_REGISTRY_KEY = "__GONOGO_AUGMENT_REGISTRY__" as const;

interface AugmentRegistry {
  augments: Map<string, { def: AnyAugment; order: number }>;
  /** Registration order, so ties in `priority` sort deterministically. */
  counter: number;
  listeners: Set<() => void>;
}

function registry(): AugmentRegistry {
  const slot = globalThis as typeof globalThis & {
    [AUGMENT_REGISTRY_KEY]?: AugmentRegistry;
  };
  slot[AUGMENT_REGISTRY_KEY] ??= {
    augments: new Map(),
    counter: 0,
    listeners: new Set(),
  };
  return slot[AUGMENT_REGISTRY_KEY];
}

/**
 * Retired slot ids, mapped to their replacements. An augment bound to a retired
 * id is stored but never rendered, so registration reports it. The retired id
 * is explained, never forwarded. Runtime cannot tell a real slot id from a typo,
 * only a retired one.
 */
export const RETIRED_SLOT_IDS: Readonly<Record<string, string>> = {
  "distance-to-target.camera": "targeting.camera",
  "distance-to-target.overlay": "targeting.overlay",
};

/** Reports a retired slot id. Falls back to `console.error` without a host, because the sdk's `logger` throws when none is installed. */
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

function notifyAugmentChange(): void {
  for (const cb of registry().listeners) cb();
}

/** Subscribe to augment registry mutations (register / clear). */
export function onAugmentsChange(cb: () => void): () => void {
  registry().listeners.add(cb);
  return () => {
    registry().listeners.delete(cb);
  };
}

/**
 * Register an augment into a widget's slot. Call at module load,
 * exactly like `registerComponent`. Multiple augments may target one slot; they
 * compose, ordered by `priority`. `component` is typed against the
 * target slot's props via the {@link SlotRegistry} declaration-merging seam.
 */
export function registerAugment<Slot extends string>(
  def: AugmentDefinition<Slot>,
): void {
  reportIfSlotRetired(def);
  const state = registry();
  state.augments.set(def.id, {
    // Erased through `unknown`: a merged `SlotProps<Slot>` is not bivariantly comparable to the erased form.
    def: def as unknown as AnyAugment,
    order: state.counter++,
  });
  notifyAugmentChange();
}

/**
 * Every augment bound to `slotName`, ordered for rendering: ascending
 * `priority` (default 0), ties in registration order. `requires` gating is
 * applied at render time by {@link AugmentSlot}, not here.
 */
export function getAugmentsForSlot(slotName: string): AnyAugment[] {
  return Array.from(registry().augments.values())
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
  return Array.from(registry().augments.values()).map((entry) => entry.def);
}

/**
 * The namespaced settings blocks contributed by every augment bound to
 * `slotName` that declares `settings`. The host widget's settings
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
  const state = registry();
  state.augments.clear();
  state.counter = 0;
  notifyAugmentChange();
}
