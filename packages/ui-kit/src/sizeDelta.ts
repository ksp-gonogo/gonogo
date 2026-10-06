import type {
  AugmentDefinition,
  ComponentDefinition,
  ContributionDefinition,
  SizeDelta,
} from "@ksp-gonogo/sitrep-sdk";
import {
  getContributionsForSlot,
  onContributionsChange,
} from "@ksp-gonogo/sitrep-sdk/spine";
import { useCallback, useEffect, useReducer } from "react";
import { getAugmentsForSlot, onAugmentsChange } from "./augments";
import { COMPONENT_SLOT_SEGMENTS } from "./contributionsRead";
import { useDomainAvailabilityStore } from "./domainAvailability";

/** What a widget's definition says about its slots, which is all {@link sizeDeltaFor} reads. */
type SizedWidget = Pick<
  ComponentDefinition,
  "id" | "augmentSlots" | "contributionSlots"
>;

/**
 * The room, in grid units, that the extensions rendering in a widget ask of it:
 * the `sizeDelta` of every augment bound to a slot the widget declares in
 * `augmentSlots`, and of every contribution in the winning priority band of a
 * slot it declares in `contributionSlots` or carries as `badges`, `filters` or
 * `meters`, summed.
 *
 * An extension counts only while it renders, so one whose `requires` Domain is
 * not present adds nothing. A contribution in an absent Domain still holds its
 * band, as it does when rendering, so a lower band stays out. Per-instance
 * augment settings are not read: the delta is a property of the widget.
 *
 * @category Extensions
 */
export function sizeDeltaFor(
  def: SizedWidget,
  isDomainPresent: (domain: string) => boolean,
): { w: number; h: number } {
  const total = { w: 0, h: 0 };
  const add = (delta: SizeDelta | undefined) => {
    total.w += delta?.w ?? 0;
    total.h += delta?.h ?? 0;
  };
  const renders = (e: Pick<AugmentDefinition, "requires">) =>
    e.requires === undefined || isDomainPresent(e.requires);

  for (const slot of new Set(def.augmentSlots ?? [])) {
    for (const augment of getAugmentsForSlot(slot)) {
      if (renders(augment)) add(augment.sizeDelta);
    }
  }
  const contributionSlots = new Set<string>([
    ...(def.contributionSlots ?? []),
    ...COMPONENT_SLOT_SEGMENTS.map((segment) => `${def.id}.${segment}`),
  ]);
  for (const slot of contributionSlots) {
    for (const contribution of getContributionsForSlot(slot)) {
      if (renders(contribution as Pick<ContributionDefinition, "requires">)) {
        add(contribution.sizeDelta);
      }
    }
  }
  return total;
}

/**
 * The definition with its `minSize` and `defaultSize` grown by `delta`: a
 * missing `minSize` counts from 1x1 and a missing `defaultSize` from the
 * dashboard's 3x3. The definition itself, unchanged, for a zero delta, so a
 * widget nothing extends keeps one identity.
 *
 * @category Extensions
 */
export function withSizeDelta<
  Def extends Pick<ComponentDefinition, "minSize" | "defaultSize">,
>(def: Def, delta: { w: number; h: number }): Def {
  if (delta.w === 0 && delta.h === 0) return def;
  const grow = (base: { w: number; h: number }) => ({
    w: base.w + delta.w,
    h: base.h + delta.h,
  });
  return {
    ...def,
    minSize: grow(def.minSize ?? { w: 1, h: 1 }),
    defaultSize: grow(def.defaultSize ?? { w: 3, h: 3 }),
  };
}

/**
 * A function reading {@link sizeDeltaFor} against the live Domain presence of
 * the nearest store, whose identity changes whenever an augment or a
 * contribution registers or a Domain's presence changes, so a memo keyed on it
 * recomputes exactly then. Outside a store every Domain reads as absent.
 *
 * @category Extensions
 */
export function useSizeDeltaFor(): (def: SizedWidget) => {
  w: number;
  h: number;
} {
  const store = useDomainAvailabilityStore();
  const [version, bump] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    const stops = [
      onAugmentsChange(bump),
      onContributionsChange(bump),
      store?.subscribe(bump),
    ];
    return () => {
      for (const stop of stops) stop?.();
    };
  }, [store]);
  // `version` is the dependency that makes this a new function on a change.
  // biome-ignore lint/correctness/useExhaustiveDependencies: see above
  return useCallback(
    (def: SizedWidget) =>
      sizeDeltaFor(def, (domain) => store?.isAvailable(domain) ?? false),
    [store, version],
  );
}
