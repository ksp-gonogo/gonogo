import { type ReactElement, useSyncExternalStore } from "react";
import {
  type AnyAugment,
  type AugmentSegmentProps,
  getAugmentsForSlot,
  onAugmentsChange,
  type SlotProps,
} from "./augments";
import { useDomainAvailable } from "./domainAvailability";
import { useWidgetMeta } from "./WidgetMetaContext";

/**
 * Renders every augment bound to a slot, ordered by priority. A base widget
 * drops an `<AugmentSlot>` where Uplinks may contribute and never references
 * any augmenting Uplink.
 *
 * `props` is REQUIRED and passed to every augment, typed against the slot's
 * {@link SlotProps} entry: an overlay slot passes its parent's projection, a
 * typed-contract slot passes the interface an augment must satisfy. Pass `{}`
 * for a slot with no props.
 *
 * An augment declaring `requires: "<domain>"` renders only while the host
 * reports that Domain present, the same presence a contribution's `requires`
 * reads; a held `<domain>.available` counts as present.
 *
 * Two mutually exclusive forms:
 *  - `name`: the full slot literal (`"power-systems.sections"`), props typed
 *    via {@link SlotRegistry}
 *  - `segment`: a reusable component writes only the segment (`"overlay"`) and
 *    this completes `${componentId}.${segment}` from `useWidgetMeta()`, props
 *    typed via {@link AugmentSegmentProps}. Outside a widget context it renders
 *    nothing
 */
export function AugmentSlot<S extends string>(
  args:
    | { name: S; props: SlotProps<S>; segment?: never }
    | { segment: S; props: AugmentSegmentProps<S>; name?: never },
): ReactElement {
  // Read unconditionally for a stable hook order; only the `segment` form uses it.
  const meta = useWidgetMeta();
  const slotName =
    args.name ?? (meta ? `${meta.componentId}.${args.segment}` : undefined);

  const augments = useAugmentsFor(slotName);

  return (
    <>
      {augments.map((augment) => (
        <AugmentEntry
          key={augment.id}
          augment={augment}
          slotProps={args.props as Record<string, unknown>}
        />
      ))}
    </>
  );
}

const EMPTY_AUGMENTS: AnyAugment[] = [];

/** Re-read on every registry change, so a slot mounted before an augment's module loads still picks it up. */
function useAugmentsFor(slotName: string | undefined): AnyAugment[] {
  return useSyncExternalStore(
    onAugmentsChange,
    () => (slotName ? getAugmentsForSlotCached(slotName) : EMPTY_AUGMENTS),
    () => (slotName ? getAugmentsForSlotCached(slotName) : EMPTY_AUGMENTS),
  );
}

/**
 * Whether anything is bound to the mounting widget's `${componentId}.${segment}`
 * slot, for a host deciding whether to draw chrome around it. Registration
 * alone: it ignores the `requires` gate.
 */
export function useWidgetSegmentBound(segment: string): boolean {
  const meta = useWidgetMeta();
  const slotName = meta ? `${meta.componentId}.${segment}` : undefined;
  return useAugmentsFor(slotName).length > 0;
}

/**
 * Whether anything is bound to a slot named in full, for a host affordance
 * (such as a tab) that must not exist unless something can fill it. Unlike the
 * segment form it does not depend on `useWidgetMeta()`. Registration alone: it
 * ignores the `requires` gate.
 */
export function useSlotBound(name: string): boolean {
  return useAugmentsFor(name).length > 0;
}

// useSyncExternalStore loops without a referentially stable snapshot, so each slot's list is memoised until the registry notifies.
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
 * Domain presence gate: true when `augment` declares no `requires`, or the host
 * reports its Domain present. A host uses it to ask the same
 * question rendering asks without rendering the augment, since a bundled
 * client registers its augments whether or not its mod is running.
 */
export function useAugmentAvailable(augment: AnyAugment): boolean {
  // Called unconditionally for a stable hook order.
  const available = useDomainAvailable(augment.requires);
  return !augment.requires || available;
}

/** One augment behind its gate, isolated so the gate hook's position is stable as the registered set changes. */
function AugmentEntry({
  augment,
  slotProps,
}: {
  augment: AnyAugment;
  slotProps: Record<string, unknown>;
}): ReactElement | null {
  if (!useAugmentAvailable(augment)) {
    return null;
  }

  const Component = augment.component;
  return <Component {...slotProps} />;
}
