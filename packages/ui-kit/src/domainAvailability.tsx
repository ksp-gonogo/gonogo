import { useSyncExternalStore } from "react";
import { createPanelStore } from "./store/createPanelStore";

/*
 * The augment presence gate asks whether an augment's Domain is live. It reads
 * a ui-kit-owned store rather than telemetry, so ui-kit takes no spine
 * dependency; the host feeds `<domain>.available` into it. With no provider
 * mounted, a Domain nothing has announced is not available.
 */

/**
 * A store of which Domains are present, keyed by Domain id (the value an
 * augment or contribution names in `requires`). Augment slots read it to
 * decide what to render, and re-render only when it changes.
 *
 * @category Extensions
 */
export interface DomainAvailabilityStore {
  /** Marks a Domain available or unavailable. Does nothing, and notifies no one, when the value is unchanged. */
  setAvailable(domain: string, available: boolean): void;
  /** Whether `domain` has announced availability. `false` for an unknown Domain. */
  isAvailable(domain: string): boolean;
  /** Calls `onChange` on any availability change. Returns a function that unsubscribes. */
  subscribe(onChange: () => void): () => void;
}

/**
 * Creates an empty {@link DomainAvailabilityStore}, in which every Domain reads
 * as unavailable until marked otherwise. Useful for seeding presence in a test
 * through {@link DomainAvailabilityContext}.
 *
 * @category Extensions
 */
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
 * The React context holding the nearest {@link DomainAvailabilityStore}, or
 * `null`, in which case every Domain reads as unavailable. Provide a store
 * from {@link createDomainAvailabilityStore} through it to seed presence in a
 * test; otherwise use {@link DomainAvailabilityProvider}.
 *
 * @category Extensions
 */
export const DomainAvailabilityContext = DomainAvailabilityPanelStore.Context;

/**
 * Creates one {@link DomainAvailabilityStore} and provides it for as long as it
 * is mounted. The app mounts one near the root and feeds it from each Domain's
 * `<domain>.available` Topic.
 *
 * @category Extensions
 */
export const DomainAvailabilityProvider = DomainAvailabilityPanelStore.Provider;

/**
 * The nearest {@link DomainAvailabilityStore}, or `null` outside a provider.
 *
 * @category Extensions
 */
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
