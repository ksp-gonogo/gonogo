import { useSyncExternalStore } from "react";
import { createPanelStore } from "./store/createPanelStore";

// ---------------------------------------------------------------------------
// Domain-availability seam (augment presence gate).
//
// `<AugmentSlot>`'s presence gate asks "is this augment's Domain live right
// now". Answering it with a telemetry read (`useTelemetry(`${requires}
// .available`)`) makes the gate a SPINE read, which strands `AugmentSlot` in
// `@ksp-gonogo/core` even though everything else about the augment model is
// spine-free.
//
// So the gate reads a ui-kit-OWNED store, exactly the shape `DelayRailContext`
// uses: ui-kit defines the store + context; the APP injects real
// `<domain>.available` presence into it from telemetry (see the app's
// augment-availability feeder). ui-kit takes NO spine dependency, and with no
// provider mounted the gate answers that a Domain nothing has announced is not
// available.
// ---------------------------------------------------------------------------

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
      // No-op when the value did not actually move, so a feeder re-emitting the
      // same presence does not wake every reader.
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
 * Carries only the store HANDLE, never the live availability map, same
 * placement as `DelayRailContext`. `null` outside a provider (a bare
 * widget/test), where `useDomainAvailable` degrades to "not available".
 *
 * Exported raw so a test can seed a store and render
 * `<DomainAvailabilityContext.Provider value={store}>`;
 * `DomainAvailabilityProvider` is the common case that mints and holds one.
 */
export const DomainAvailabilityContext = DomainAvailabilityPanelStore.Context;

/** Mints one availability store and holds it for its whole life. The host (the
 * app) mounts this once near the root and feeds it from telemetry. */
export const DomainAvailabilityProvider = DomainAvailabilityPanelStore.Provider;

/** The nearest availability store, or `null` outside a provider. */
export const useDomainAvailabilityStore = DomainAvailabilityPanelStore.useStore;

// Stable no-store fallbacks so `useSyncExternalStore` sees a referentially
// stable subscribe and a primitive snapshot with no provider in the tree.
const NO_SUBSCRIBE = (): (() => void) => () => {};

/**
 * Whether `domain`'s Domain is currently available, read reactively from the
 * nearest {@link DomainAvailabilityStore}. `undefined` (an ungated augment) and
 * a Domain nothing has announced both read `false`; a Domain the app's feeder
 * has marked live reads `true`. With no store in the tree it is `false`: an
 * unannounced Domain and an unreachable feeder are the same answer.
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
