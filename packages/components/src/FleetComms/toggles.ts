import { DashboardItemContext } from "@ksp-gonogo/core";
import { useCallback, useContext, useSyncExternalStore } from "react";

/**
 * The Commlinks and Traffic toggles, one pair per SystemView instance.
 *
 * The controls are drawn by the `system-view.actions` augment and read by
 * `SystemView/index.tsx`, which gates its connection-line entities and
 * command-traffic pulses on them. The augment is mounted in the panel chrome
 * rather than under anything SystemView provides, so a React context from one
 * cannot reach the other and the state sits in this external store instead.
 *
 * Both sides mount inside the same `DashboardItemContext`, so its instance id
 * is the key: two SystemView tiles on one dashboard each keep their own pair.
 * A tree with no dashboard item (a bare widget render) shares one pair.
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

const NO_INSTANCE = "";

const togglesByInstance = new Map<string, FleetCommsToggles>();
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) listener();
}

/** One instance's toggle state: referentially stable between changes, required by `useSyncExternalStore`. */
export function getFleetCommsToggles(instanceId: string): FleetCommsToggles {
  return togglesByInstance.get(instanceId) ?? DEFAULT_TOGGLES;
}

/** Subscribe to toggle changes on any instance. Returns an unsubscribe function. */
export function subscribeFleetCommsToggles(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function update(instanceId: string, patch: Partial<FleetCommsToggles>): void {
  const current = getFleetCommsToggles(instanceId);
  const next = { ...current, ...patch };
  if (
    next.showCommlinks === current.showCommlinks &&
    next.showCommandTraffic === current.showCommandTraffic
  ) {
    return;
  }
  togglesByInstance.set(instanceId, next);
  notify();
}

export function setShowCommlinks(instanceId: string, value: boolean): void {
  update(instanceId, { showCommlinks: value });
}

export function setShowCommandTraffic(
  instanceId: string,
  value: boolean,
): void {
  update(instanceId, { showCommandTraffic: value });
}

/** The key the calling component's toggles are stored under. */
export function useFleetCommsInstanceId(): string {
  return useContext(DashboardItemContext)?.instanceId ?? NO_INSTANCE;
}

/** React binding: the actions augment and SystemView read the same instance's live snapshot. */
export function useFleetCommsToggles(): FleetCommsToggles {
  const instanceId = useFleetCommsInstanceId();
  const snapshot = useCallback(
    () => getFleetCommsToggles(instanceId),
    [instanceId],
  );
  return useSyncExternalStore(subscribeFleetCommsToggles, snapshot, snapshot);
}

/** Test-only: resets the module-scoped store between tests (mirrors `clearRegistry`/`clearAugments`). */
export function __resetFleetCommsTogglesForTests(): void {
  togglesByInstance.clear();
  listeners.clear();
}
