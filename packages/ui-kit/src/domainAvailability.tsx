import { useSyncExternalStore } from "react";
import { createPanelStore } from "./store/createPanelStore";

/*
 * The augment presence gate asks whether an augment's Domain is live. It reads
 * a ui-kit-owned store rather than telemetry, so ui-kit takes no spine
 * dependency; the host feeds `<domain>.available` into it. With no provider
 * mounted, a Domain nothing has announced is not available.
 */

/**
 * A tiny off-tree store of which Domains have announced availability, keyed by
 * the Domain id (`augment.requires`). The live map stays in the store, never in
 * a React context value, so a presence change re-renders only the augment slots
 * that read the changed Domain, not every widget in the tree.
 */
export interface DomainAvailabilityStore {
  /** Mark a Domain available / unavailable. No-op (no notify) when unchanged. */
  setAvailable(domain: string, available: boolean): void;
  /** Whether `domain` has announced availability. `false` for an unknown Domain. */
  isAvailable(domain: string): boolean;
  /** Subscribe to any availability change. Returns unsubscribe. */
  subscribe(onChange: () => void): () => void;
}

export function createDomainAvailabilityStore(): DomainAvailabilityStore {
  const availability = new Map<string, boolean>();
  const listeners = new Set<() => void>();
  return {
    setAvailable(domain, available) {
      // A feeder re-emitting the same presence wakes no reader.
      if (availability.get(domain) === available) return;
      availability.set(domain, available);
      for (const listener of listeners) listener();
    },
    isAvailable(domain) {
      return availability.get(domain) ?? false;
    },
    subscribe(onChange) {
      listeners.add(onChange);
      return () => {
        listeners.delete(onChange);
      };
    },
  };
}

const DomainAvailabilityPanelStore = createPanelStore(
  createDomainAvailabilityStore,
);

/**
 * Carries only the store handle, never the live map. `null` outside a
 * provider, where `useDomainAvailable` answers "not available". Exported so a
 * test can seed a store; `DomainAvailabilityProvider` is the common case.
 */
export const DomainAvailabilityContext = DomainAvailabilityPanelStore.Context;

/** Mints one availability store and holds it for its whole life. The host (the
 * app) mounts this once near the root and feeds it from telemetry. */
export const DomainAvailabilityProvider = DomainAvailabilityPanelStore.Provider;

/** The nearest availability store, or `null` outside a provider. */
export const useDomainAvailabilityStore = DomainAvailabilityPanelStore.useStore;

// Stable fallbacks for `useSyncExternalStore` with no provider in the tree.
const NO_SUBSCRIBE = (): (() => void) => () => {};

/**
 * Whether `domain`'s Domain is currently available, read reactively from the
 * nearest {@link DomainAvailabilityStore}. `undefined`, a Domain nothing has
 * announced, and a tree with no store all read `false`.
 */
export function useDomainAvailable(domain: string | undefined): boolean {
  const store = useDomainAvailabilityStore();
  const snapshot = (): boolean =>
    store && domain ? store.isAvailable(domain) : false;
  return useSyncExternalStore(
    store ? store.subscribe : NO_SUBSCRIBE,
    snapshot,
    snapshot,
  );
}
