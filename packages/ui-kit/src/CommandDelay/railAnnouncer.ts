import { useSyncExternalStore } from "react";
import { type DelayRailStore, useDelayRailStore } from "./DelayRailContext";

/*
 * A panel's rail speaks every outcome of the commands registered on its store,
 * so a control on that store stays quiet rather than say it a second time. The
 * claim is per store and held only while a rail is mounted on it: a widget that
 * composes no rail still hears its own controls.
 */
const claims = new WeakMap<DelayRailStore, number>();
const listeners = new WeakMap<DelayRailStore, Set<() => void>>();

function notify(store: DelayRailStore): void {
  for (const listener of listeners.get(store) ?? []) listener();
}

export function claimRailAnnouncer(store: DelayRailStore): () => void {
  claims.set(store, (claims.get(store) ?? 0) + 1);
  notify(store);
  return () => {
    claims.set(store, (claims.get(store) ?? 1) - 1);
    notify(store);
  };
}

export function useRailAnnounces(): boolean {
  const store = useDelayRailStore();
  return useSyncExternalStore(
    (onChange) => {
      if (!store) return () => {};
      const set = listeners.get(store) ?? new Set<() => void>();
      listeners.set(store, set);
      set.add(onChange);
      return () => set.delete(onChange);
    },
    () => store !== null && (claims.get(store) ?? 0) > 0,
    () => false,
  );
}
