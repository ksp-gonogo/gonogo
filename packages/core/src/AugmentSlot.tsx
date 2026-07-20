import type { TopicId } from "@ksp-gonogo/sitrep-sdk";
import { type ReactElement, useSyncExternalStore } from "react";
import {
  type AnyAugment,
  getAugmentsForSlot,
  onAugmentsChange,
  type SlotProps,
} from "./augments";
import { useTelemetry } from "./hooks/useTelemetry";

/**
 * Renders every augment bound to `name`, ordered by priority (spec §4). This is
 * the composition point the **host** owns: a base widget drops an `<AugmentSlot>`
 * where Uplinks may contribute, and this component assembles whatever is
 * registered — the base widget never references any augmenting Uplink.
 *
 * `props` is REQUIRED (spec §4.4): slot props are passed down to every augment,
 * typed against the slot's {@link SlotProps} entry. Overlay slots pass their
 * parent's projection/transform so an augment can draw in the parent's
 * coordinate space; typed-contract slots (e.g. `objectives.sections`) pass the
 * interface an augment must satisfy. Pass `{}` for a slot with no props.
 *
 * Presence gating (spec §4.2): an augment declaring `requires: "<domain>"`
 * renders only while that Domain's `<domain>.available` Topic is live. Each
 * augment's gate is evaluated inside its own {@link AugmentEntry} so the hook
 * count per rendered augment is stable even as the registered set changes.
 */
export function AugmentSlot<S extends string>({
  name,
  props,
}: {
  name: S;
  props: SlotProps<S>;
}): ReactElement {
  // Re-render when augments register/unregister so a slot mounted before an
  // augment's module loads still picks it up (mirrors onDataSourcesChange).
  const augments = useSyncExternalStore(
    onAugmentsChange,
    () => getAugmentsForSlotCached(name),
    () => getAugmentsForSlotCached(name),
  );

  return (
    <>
      {augments.map((augment) => (
        <AugmentEntry
          key={augment.id}
          augment={augment}
          slotProps={props as Record<string, unknown>}
        />
      ))}
    </>
  );
}

// useSyncExternalStore requires a referentially-stable snapshot between changes,
// else it loops. getAugmentsForSlot builds a fresh array each call, so memoise
// per slot name and only recompute when the registry actually notifies.
const slotCache = new Map<string, AnyAugment[]>();
let cacheValid = false;
onAugmentsChange(() => {
  cacheValid = false;
  slotCache.clear();
});
function getAugmentsForSlotCached(name: string): AnyAugment[] {
  if (!cacheValid) {
    slotCache.clear();
    cacheValid = true;
  }
  let cached = slotCache.get(name);
  if (cached === undefined) {
    cached = getAugmentsForSlot(name);
    slotCache.set(name, cached);
  }
  return cached;
}

/**
 * Domain presence gate (spec §4.2): true when `augment` declares no
 * `requires` (ungated — always available), or its `<requires>.available`
 * Topic is currently live (any defined value, not just truthy — matches
 * the Topic's own "presence, not payload" semantics).
 *
 * Extracted so a HOST can ask "is this augment's Domain live right now"
 * without rendering the augment's own component — e.g. MapView's vanilla-
 * suppression decision (`suppressesVanillaBase`, augments.ts) must only
 * suppress its default surface while the declaring augment's Domain is
 * actually live, not merely because the augment is registered; reading the
 * registry alone can't answer that, since a bundled-but-not-running mod's
 * client package registers its augments unconditionally at import time.
 * `AugmentEntry` below is just this hook's original, sole caller.
 */
export function useAugmentAvailable(augment: AnyAugment): boolean {
  // Always call the hook (stable order); the topic is only meaningful when the
  // augment declares `requires`. A dummy topic for the ungated case reads
  // `undefined` off the store and is never consulted.
  const availabilityTopic = (
    augment.requires ? `${augment.requires}.available` : ""
  ) as TopicId;
  const available = useTelemetry(availabilityTopic);
  return !augment.requires || available !== undefined;
}

/**
 * Renders one augment, applying its Domain presence gate. Isolated into its own
 * component so its `useTelemetry` gate hook has a stable position regardless of
 * how many siblings the slot has or how the registered set changes.
 */
function AugmentEntry({
  augment,
  slotProps,
}: {
  augment: AnyAugment;
  slotProps: Record<string, unknown>;
}): ReactElement | null {
  if (!useAugmentAvailable(augment)) {
    // Domain absent → augment not rendered (spec §4.2).
    return null;
  }

  const Component = augment.component;
  return <Component {...slotProps} />;
}
