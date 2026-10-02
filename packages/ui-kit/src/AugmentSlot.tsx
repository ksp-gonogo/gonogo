import { type ReactElement, useSyncExternalStore } from "react";
import {
  type AnyAugment,
  type AugmentSegmentProps,
  getAugmentsForSlot,
  onAugmentsChange,
  type SlotProps,
} from "./augments";
import {
  useDomainAvailabilityStore,
  useDomainAvailable,
} from "./domainAvailability";
import { InactiveNotice } from "./InactiveNotice";
import { LockScope } from "./LockScope";
import { Section } from "./Section";
import { useWidgetMeta } from "./WidgetMetaContext";

/**
 * Renders every augment bound to a slot, in priority order, as siblings in a
 * fragment. A widget places an `<AugmentSlot>` where Uplinks may add content
 * and never names the Uplinks that fill it. Augments registered after the slot
 * mounts appear when they register.
 *
 * `props` is required and passed to every augment, typed against the slot's
 * {@link SlotProps} entry: an overlay slot passes its parent's projection, for
 * example. Pass `{}` for a slot with no props.
 *
 * An augment declaring `requires: "<domain>"` renders only while the host
 * reports that Domain present; a held `<domain>.available` counts as present.
 *
 * Two forms, of which a call uses one:
 *  - `name`: the full slot id (`"power-systems.sections"`), props typed
 *    through {@link SlotRegistry}
 *  - `segment`: only the segment (`"overlay"`), completed to
 *    `${componentId}.<segment>` for the widget it renders in, props typed
 *    through {@link AugmentSegmentProps}. Outside a widget it renders nothing
 *
 * @example
 * ```tsx
 * <AugmentSlot name="crew-status.row-badges" props={{ crewName: kerbal.name }} />
 * ```
 *
 * @category Extensions
 */
export function AugmentSlot<Slot extends string>(
  args:
    | { name: Slot; props: SlotProps<Slot>; segment?: never }
    | { segment: Slot; props: AugmentSegmentProps<Slot>; name?: never },
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
          asSection={slotName?.endsWith(".sections") === true}
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
 * Whether anything would render in the current widget's
 * `${componentId}.<segment>` slot, for a widget deciding whether to draw
 * chrome around it. Counts only augments whose `requires` Domain is present,
 * so an Uplink whose mod is not running changes no layout. False outside a
 * widget.
 *
 * @category Extensions
 */
export function useWidgetSegmentBound(segment: string): boolean {
  const meta = useWidgetMeta();
  const slotName = meta ? `${meta.componentId}.${segment}` : undefined;
  return useAnyAvailable(useAugmentsFor(slotName));
}

/**
 * Whether anything would render in the slot with the full id `name`, for a
 * widget affordance (a tab, a reserved cell) that should exist only when
 * something can fill it. Counts only augments whose `requires` Domain is
 * present, so an Uplink whose mod is not running changes no layout. Unlike
 * {@link useWidgetSegmentBound} it works outside a widget.
 *
 * @category Extensions
 */
export function useSlotBound(name: string): boolean {
  return useAnyAvailable(useAugmentsFor(name));
}

const NO_SUBSCRIBE = (): (() => void) => () => {};

/** Whether any of `augments` passes the same presence gate {@link AugmentEntry} applies, re-read as Domains announce. */
function useAnyAvailable(augments: AnyAugment[]): boolean {
  const store = useDomainAvailabilityStore();
  const snapshot = (): boolean =>
    augments.some(
      (augment) =>
        !augment.requires || store?.isAvailable(augment.requires) === true,
    );
  return useSyncExternalStore(
    store ? store.subscribe : NO_SUBSCRIBE,
    snapshot,
    snapshot,
  );
}

/**
 * The `label` of the first available augment bound to the slot `name`, in
 * render order, for a widget that needs a caption before it draws the slot,
 * such as a tab's label. `undefined` while nothing is bound, nothing bound has
 * its `requires` Domain present, or the first available augment declares no
 * label. With several augments bound, only the first one's label is used,
 * while {@link AugmentSlot} renders them all together.
 *
 * @category Extensions
 */
export function useSlotLabel(name: string): string | undefined {
  const augments = useAugmentsFor(name);
  const store = useDomainAvailabilityStore();
  const snapshot = (): string | undefined =>
    augments.find(
      (augment) =>
        !augment.requires || store?.isAvailable(augment.requires) === true,
    )?.label;
  return useSyncExternalStore(
    store ? store.subscribe : NO_SUBSCRIBE,
    snapshot,
    snapshot,
  );
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
 * True when `augment` declares no `requires`, or the host reports its Domain
 * present: the same check {@link AugmentSlot} makes before rendering it. Use
 * it to ask that question without rendering the augment, since an Uplink
 * client registers its augments whether or not its mod is running.
 *
 * @category Extensions
 */
export function useAugmentAvailable(augment: AnyAugment): boolean {
  // Called unconditionally for a stable hook order.
  const available = useDomainAvailable(augment.requires);
  return !augment.requires || available;
}

/**
 * One augment behind its gate, isolated so the gate hook's position is stable
 * as the registered set changes.
 *
 * Each augment is its own lock scope. An Uplink's section reads and commands
 * through hooks in its own body, which would otherwise claim against the host
 * widget's scope and take the whole host down for a capability only the
 * augment uses. A locked augment in a sections slot draws the missing unlock
 * under its label; anywhere else (an overlay, a badge) it draws nothing.
 */
function AugmentEntry({
  augment,
  slotProps,
  asSection,
}: {
  augment: AnyAugment;
  slotProps: Record<string, unknown>;
  asSection: boolean;
}): ReactElement | null {
  if (!useAugmentAvailable(augment)) {
    return null;
  }

  const Component = augment.component;
  return (
    <LockScope
      fallback={
        asSection
          ? (lock) => (
              <Section title={augment.label}>
                <InactiveNotice reason={lock} />
              </Section>
            )
          : null
      }
    >
      <Component {...slotProps} />
    </LockScope>
  );
}
