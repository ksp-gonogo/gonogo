import { getAugments, onAugmentsChange, useTelemetry } from "@ksp-gonogo/core";
import type { TopicId } from "@ksp-gonogo/sitrep-sdk";
import {
  type DomainAvailabilityStore,
  useDomainAvailabilityStore,
} from "@ksp-gonogo/ui-kit";
import { type ReactElement, useEffect, useSyncExternalStore } from "react";

/**
 * Feeds ui-kit's domain-availability store from telemetry, so `<AugmentSlot>`'s
 * presence gate (which reads that store, not a spine hook) sees real
 * `<domain>.available` presence. This is the app-side injection the
 * `DelayRailContext` pattern calls for: ui-kit owns the store + the gate;
 * the app owns the wire read.
 *
 * Headless. Mounted once per screen INSIDE `SitrepTelemetryProvider` (so
 * `useTelemetry` resolves) and BELOW the root `DomainAvailabilityProvider` (so
 * the store resolves), sitting alongside the other headless telemetry siblings
 * the screen already mounts. With no store above it, it renders nothing.
 *
 * It watches EVERY distinct Domain any registered augment `requires`, not just
 * the ones a mounted slot happens to show, so availability is global truth: a
 * `suppressesVanillaBase` decision and a slot in another widget read the same
 * answer. One telemetry subscription per Domain regardless of how many augments
 * or slots reference it.
 */
export function AugmentAvailabilityFeeder(): ReactElement | null {
  const store = useDomainAvailabilityStore();
  const domains = useSyncExternalStore(
    onAugmentsChange,
    getRequiredDomains,
    getRequiredDomains,
  );

  if (!store) return null;
  return (
    <>
      {domains.map((domain) => (
        <DomainAvailabilityWatch key={domain} domain={domain} store={store} />
      ))}
    </>
  );
}

/**
 * Subscribes to one Domain's `<domain>.available` Topic and mirrors its
 * presence into the store. Presence, not payload: a Domain is available while
 * ANY value has arrived (`!== undefined`), matching the Topic's own semantics
 * and the exact answer the old telemetry gate gave. Isolated per Domain so its
 * `useTelemetry` hook has a stable position as the watched set changes.
 */
function DomainAvailabilityWatch({
  domain,
  store,
}: {
  domain: string;
  store: DomainAvailabilityStore;
}): null {
  const availability = useTelemetry(`${domain}.available` as TopicId);
  /**
   * Whether the domain has EVER reported, which is what a presence gate asks.
   *
   * `pending` is the only answer that means "no Uplink here". Everything else is the
   * producer speaking: `observed` obviously, `stale` because a domain that reported
   * and went quiet is still installed, and `absent` because a producer saying "there
   * is no value" is still a producer. That last one is why the pre-migration
   * `value !== undefined` accidentally got the tombstone case RIGHT while getting
   * everything else wrong, and it is the rule the Uplink-side availability feeders
   * use too.
   */
  const reported = availability.state !== "pending";
  useEffect(() => {
    store.setAvailable(domain, reported);
    return () => store.setAvailable(domain, false);
  }, [domain, reported, store]);
  return null;
}

// The distinct Domains any registered augment gates on, cached so
// `useSyncExternalStore` gets a referentially-stable snapshot between augment
// registrations (a fresh array each call would loop it). Recomputed only after
// the registry notifies, and only replaced when the set actually changed.
let cachedDomains: string[] = [];
let domainsDirty = true;
onAugmentsChange(() => {
  domainsDirty = true;
});
function getRequiredDomains(): string[] {
  if (!domainsDirty) return cachedDomains;
  const set = new Set<string>();
  for (const augment of getAugments()) {
    if (augment.requires) set.add(augment.requires);
  }
  const next = Array.from(set).sort();
  const changed =
    next.length !== cachedDomains.length ||
    next.some((domain, i) => domain !== cachedDomains[i]);
  if (changed) cachedDomains = next;
  domainsDirty = false;
  return cachedDomains;
}
