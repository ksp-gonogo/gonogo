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
 * Renders every augment bound to `name`, ordered by priority (spec §4). This is
 * the composition point the **host** owns: a base widget drops an `<AugmentSlot>`
 * where Uplinks may contribute, and this component assembles whatever is
 * registered: the base widget never references any augmenting Uplink.
 *
 * `props` is REQUIRED (spec §4.4): slot props are passed down to every augment,
 * typed against the slot's {@link SlotProps} entry. Overlay slots pass their
 * parent's projection/transform so an augment can draw in the parent's
 * coordinate space; typed-contract slots (e.g. `objectives.source`) pass the
 * interface an augment must satisfy. Pass `{}` for a slot with no props.
 *
 * Presence gating (spec §4.2): an augment declaring `requires: "<domain>"`
 * renders only while that Domain is live. The gate reads ui-kit's own
 * {@link useDomainAvailable} store (fed from telemetry by the app), NOT a
 * spine hook, so this whole component is spine-free and ships from the
 * published design floor. Each augment's gate is evaluated inside its own
 * {@link AugmentEntry} so the hook count per rendered augment is stable even
 * as the registered set changes.
 *
 * Two mutually-exclusive prop forms (component-extension-slots design §1):
 *  - `name`: the widget-led form, UNCHANGED. The host writes the full slot
 *    literal (`"power-systems.sections"`) and its props type resolves via
 *    {@link SlotRegistry}. Existing callers are byte-identical.
 *  - `segment`: the component-led form. A reusable component writes only the
 *    SEGMENT (`"overlay"`) and this completes `${componentId}.${segment}` from
 *    `useWidgetMeta()`; props resolve via {@link AugmentSegmentProps}. Outside
 *    a widget context (`useWidgetMeta()` null) the segment slot renders nothing.
 */
export function AugmentSlot<S extends string>(
  args:
    | { name: S; props: SlotProps<S>; segment?: never }
    | { segment: S; props: AugmentSegmentProps<S>; name?: never },
): ReactElement {
  // Read the mounting widget's meta unconditionally (stable hook order). Only
  // the `segment` form consults it, to complete `${componentId}.${segment}`;
  // the `name` form ignores meta entirely, so its render is unchanged.
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

// Stable empty snapshot for a `segment` slot mounted outside a widget context:
// `useSyncExternalStore` needs a referentially-stable value between changes.
const EMPTY_AUGMENTS: AnyAugment[] = [];

/**
 * The augments currently bound to `slotName`, re-read whenever the registry
 * changes so a slot mounted before an augment's module loads still picks it up
 * (mirrors `onDataSourcesChange`). `undefined` for a slot that has no name yet
 * (a `segment` form outside a widget context) reads as empty.
 */
function useAugmentsFor(slotName: string | undefined): AnyAugment[] {
  return useSyncExternalStore(
    onAugmentsChange,
    () => (slotName ? getAugmentsForSlotCached(slotName) : EMPTY_AUGMENTS),
    () => (slotName ? getAugmentsForSlotCached(slotName) : EMPTY_AUGMENTS),
  );
}

/**
 * Whether anything is bound to the mounting widget's `${componentId}.${segment}`
 * slot. For a host that must decide whether to render CHROME around a segment
 * at all: `<AugmentSlot>` renders no DOM when nothing is bound, but a wrapper
 * the host puts around it does, and an empty bordered box on every panel in the
 * app is not "renders nothing until an augment binds".
 *
 * Registration alone, NOT the Domain presence gate: each augment's `requires`
 * is evaluated inside its own entry at render, so this answers "is this
 * extension point claimed", which is what a chrome decision turns on.
 */
export function useWidgetSegmentBound(segment: string): boolean {
  const meta = useWidgetMeta();
  const slotName = meta ? `${meta.componentId}.${segment}` : undefined;
  return useAugmentsFor(slotName).length > 0;
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
 * `requires` (ungated; always available), or its Domain is currently live per
 * ui-kit's {@link useDomainAvailable} store (fed from `<requires>.available`
 * telemetry by the app).
 *
 * Extracted so a HOST can ask "is this augment's Domain live right now"
 * without rendering the augment's own component: e.g. MapView's vanilla-
 * suppression decision (`suppressesVanillaBase`, augments.ts) must only
 * suppress its default surface while the declaring augment's Domain is
 * actually live, not merely because the augment is registered; reading the
 * registry alone can't answer that, since a bundled-but-not-running mod's
 * client package registers its augments unconditionally at import time.
 * `AugmentEntry` below is just this hook's original, sole caller.
 */
export function useAugmentAvailable(augment: AnyAugment): boolean {
  // Always call the hook (stable order); `useDomainAvailable` reads `false` for
  // the ungated case (`requires` undefined), which the short-circuit ignores.
  const available = useDomainAvailable(augment.requires);
  return !augment.requires || available;
}

/**
 * Renders one augment, applying its Domain presence gate. Isolated into its own
 * component so its gate hook has a stable position regardless of how many
 * siblings the slot has or how the registered set changes.
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
