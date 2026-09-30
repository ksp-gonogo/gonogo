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
 * The standard augment segments every widget's {@link Panel} carries, each
 * mapped to the props its augments receive. A segment completes to the slot id
 * `${componentId}.<segment>` for the widget it is mounted in, as
 * `<AugmentSlot segment="...">` does. Both segments pass no props
 * (`Record<string, never>`): an augment reads its own Topics, and reads what
 * the widget is focused on through `useWidgetScope`.
 *
 * @category Panel
 */
export interface AugmentSegmentRegistry {
  /**
   * Body content after everything the widget draws, as the slot
   * `${componentId}.sections`. Inside a panel with `sections`, each augment is
   * one item of the last section grid, so a returned `Section` takes a column.
   */
  sections: Record<string, never>;
  /**
   * Controls in the widget's panel header aside, as the slot
   * `${componentId}.actions`: after the widget's own `panelAside`, before its
   * badges.
   */
  actions: Record<string, never>;
}

/**
 * The props an augment bound to a standard segment receives, looked up in
 * {@link AugmentSegmentRegistry}: `Record<string, never>` for `sections` and
 * `actions`, and `never` for a name that is not a standard segment.
 *
 * @category Panel
 */
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
 * widget's slot. `Slot` is inferred from `augments`, so `component` is typed
 * against that slot's {@link SlotProps}.
 */
export type {
  AugmentDefinition,
  AugmentSettingField,
  NamespacedAugmentSettings,
} from "@ksp-gonogo/sitrep-sdk";

// `SlotProps<string>` would resolve to `never` for an undeclared slot, so the props are erased here and `Slot` is checked at the `registerAugment` call site instead.
/**
 * An augment as the registry holds it, whatever slot it binds: an
 * `AugmentDefinition` whose component takes a loose props object. The lookup
 * functions ({@link getAugmentsForSlot}, {@link getAugments}) return this.
 *
 * @category Extensions
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
 * Slot ids that no widget mounts any more, each mapped to the slot that
 * replaced it. {@link registerAugment} logs an error naming the replacement
 * when an augment binds one of these; the augment is stored but never renders.
 * A misspelled slot id is not detected at runtime.
 *
 * @category Extensions
 */
export const RETIRED_SLOT_IDS: Readonly<Record<string, string>> = {
  "distance-to-target.camera": "targeting.camera",
  "distance-to-target.overlay": "targeting.overlay",
  "astronaut-complex.training": "astronaut-complex.tab",
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

/**
 * Calls `cb` whenever an augment is registered or the registry is cleared.
 * Returns a function that unsubscribes.
 *
 * @category Extensions
 */
export function onAugmentsChange(cb: () => void): () => void {
  registry().listeners.add(cb);
  return () => {
    registry().listeners.delete(cb);
  };
}

/**
 * Registers an augment into a widget's slot. Call it at module load, like
 * `registerComponent`. Several augments may bind one slot; they all render,
 * ordered by `priority`. Registering an id again replaces the earlier augment.
 * `component` is typed against the slot's props in {@link SlotRegistry}.
 *
 * An Uplink calls the `registerAugment` exported by `@ksp-gonogo/sitrep-sdk`,
 * which reaches this registry through the host. For binding a widget's
 * standard `sections` or `actions` slot, see {@link Panel}.
 *
 * @category Extensions
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
 * Every augment bound to `slotName`, in render order: ascending `priority`
 * (default 0), ties in registration order. It includes augments whose
 * `requires` Domain is absent; {@link AugmentSlot} applies that gate when it
 * renders.
 *
 * @category Extensions
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

/**
 * Every registered augment, in no particular order.
 *
 * @category Extensions
 */
export function getAugments(): AnyAugment[] {
  return Array.from(registry().augments.values()).map((entry) => entry.def);
}

/**
 * One settings block for each augment bound to `slotName` that declares
 * `settings`, in render order. The host widget's settings panel shows these
 * after its own settings; each block's `namespace` (the augment id) scopes its
 * fields in the widget instance's config. An Uplink that is not loaded adds no
 * block.
 *
 * @category Extensions
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

/**
 * Empties the augment registry and notifies subscribers. For tests only.
 *
 * @category Extensions
 */
export function clearAugments(): void {
  const state = registry();
  state.augments.clear();
  state.counter = 0;
  notifyAugmentChange();
}
