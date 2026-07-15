import { useSyncExternalStore } from "react";

/**
 * Shared state between the two halves of ONE coordinated augment
 * (`SystemView/index.tsx`'s own doc comment: "the `.actions` + `.overlay`
 * pair is designed to be driven by ONE coordinated augment ... sharing state
 * through the augment's OWN context — no cross-Uplink coupling"). The host
 * renders `system-view.actions` (the header toggle row) and
 * `system-view.overlay` (the diagram layer) as two SEPARATE, independently
 * mounted `<AugmentSlot>` trees — neither is a descendant of the other, so a
 * React context provided by one can't reach the other. A tiny module-scoped
 * external store (the same `useSyncExternalStore` idiom this codebase
 * already uses throughout `@ksp-gonogo/sitrep-client`'s stream hooks) is the
 * simplest thing that actually reaches across that gap.
 *
 * First-party, dashboard-instance-wide (not per-widget-instance) — there is
 * only ever one active vessel / one system diagram on screen at a time, so a
 * single module-level toggle pair is the right scope; a future multi-instance
 * SystemView would need to key this by instance id, not attempted here.
 */
export interface FleetCommsToggles {
  /** Draw the active vessel's comms-path highlight + connectivity styling. */
  showCommlinks: boolean;
  /** Draw the command-traffic (pending-uplink) pulse overlay. */
  showCommandTraffic: boolean;
}

const DEFAULT_TOGGLES: FleetCommsToggles = {
  showCommlinks: true,
  showCommandTraffic: true,
};

let toggles: FleetCommsToggles = DEFAULT_TOGGLES;
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) listener();
}

/** Current toggle state — referentially stable between changes, required by `useSyncExternalStore`. */
export function getFleetCommsToggles(): FleetCommsToggles {
  return toggles;
}

/** Subscribe to toggle changes. Returns an unsubscribe function. */
export function subscribeFleetCommsToggles(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function setShowCommlinks(value: boolean): void {
  if (toggles.showCommlinks === value) return;
  toggles = { ...toggles, showCommlinks: value };
  notify();
}

export function setShowCommandTraffic(value: boolean): void {
  if (toggles.showCommandTraffic === value) return;
  toggles = { ...toggles, showCommandTraffic: value };
  notify();
}

/** React binding — both the overlay and the actions augment read the SAME live snapshot. */
export function useFleetCommsToggles(): FleetCommsToggles {
  return useSyncExternalStore(
    subscribeFleetCommsToggles,
    getFleetCommsToggles,
    getFleetCommsToggles,
  );
}

/** Test-only — resets the module-scoped store between tests (mirrors `clearRegistry`/`clearAugments`). */
export function __resetFleetCommsTogglesForTests(): void {
  toggles = DEFAULT_TOGGLES;
  listeners.clear();
}
