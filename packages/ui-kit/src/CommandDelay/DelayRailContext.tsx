import { RailRegistryContext } from "@ksp-gonogo/sitrep-sdk/spine";
import { type ReactNode, useSyncExternalStore } from "react";
import { createPanelStore } from "../store/createPanelStore";
import { createStore } from "../store/createStore";
import type { CommandDelayHandle } from "./CommandDelay";

/**
 * One command's delay-output registration into the Panel-scoped rail: the
 * handle plus a stable `id` minted by its registrant, so the registry never
 * relies on object identity (a handle is a fresh literal on most renders).
 *
 * @category CommandDelay
 */
export interface CommandHandle extends CommandDelayHandle {
  /** Stable for the registering hook's whole mounted life. */
  id: string;
}

/**
 * A per-panel, off-tree registry of active command handles. `update` keeps a
 * registered handle current in place. The live data lives in the store, never
 * in a context value, so a registration change re-renders only the rail's
 * subscribers.
 */
export interface DelayRailStore {
  /** Add or replace a handle (keyed on `handle.id`). Returns its deregister function. */
  register(handle: CommandHandle): () => void;
  /** Update a registered handle's non-id fields in place (keyed on `id`). */
  update(id: string, next: Omit<CommandHandle, "id">): void;
  /** Subscribe to any change in the active handle set. Returns unsubscribe. */
  subscribe(onChange: () => void): () => void;
  /** The current active handles, insertion-ordered, referentially stable while unchanged. */
  getActiveHandles(): readonly CommandHandle[];
}

/**
 * Create an empty delay-rail store, for a caller that owns its lifetime and provides it through {@link DelayRailContext}.
 *
 * @category CommandDelay
 */
export function createDelayRailStore(): DelayRailStore {
  const base = createStore<CommandHandle>();
  return {
    register: base.register,
    update: base.update,
    subscribe: base.subscribe,
    getActiveHandles: base.getSnapshot,
  };
}

const DelayPanelStore = createPanelStore(createDelayRailStore);

/**
 * Carries only the store HANDLE, never the live registrations. `null` outside
 * a `Panel`, where `useRailEntry` and `useActiveHandles` degrade to no-ops.
 * Exported raw for a caller that owns the store's lifetime.
 *
 * @category CommandDelay
 */
export const DelayRailContext = DelayPanelStore.Context;

/**
 * Mints one delay-rail store and holds it for its whole life. It is also the
 * rail registry every `useCommand` beneath it registers with, so each command's
 * outcome reaches the rail with nothing wired in the widget. The dashboard
 * mounts one around every widget; a dev build throws on a dispatch with none
 * mounted.
 *
 * @category CommandDelay
 */
export function DelayRailProvider({ children }: { children?: ReactNode }) {
  return (
    <DelayPanelStore.Provider>
      <CommandRailBridge>{children}</CommandRailBridge>
    </DelayPanelStore.Provider>
  );
}

function CommandRailBridge({ children }: { children?: ReactNode }) {
  const store = DelayPanelStore.useStore();
  return (
    <RailRegistryContext.Provider value={store}>
      {children}
    </RailRegistryContext.Provider>
  );
}

/**
 * The nearest store, or `null` outside a `Panel`. Does not subscribe, so a registering widget does not re-render when a sibling registers.
 *
 * @intent Published so a third party can build a representation of the rail of its own, as Console does.
 * @category CommandDelay
 */
export const useDelayRailStore = DelayPanelStore.useStore;

// Stable no-store fallbacks: a fresh `[]` would make `useSyncExternalStore` loop.
const NO_SUBSCRIBE = (): (() => void) => () => {};
const NO_HANDLES: readonly CommandHandle[] = [];
const NO_HANDLES_SNAPSHOT = (): readonly CommandHandle[] => NO_HANDLES;

/**
 * The panel's active command handles, or `[]` when the store is empty or there
 * is no store in the tree. A subscriber (`Panel.Delay`) re-renders only when
 * the active handle set changes.
 *
 * @category CommandDelay
 */
export function useActiveHandles(): readonly CommandHandle[] {
  const store = useDelayRailStore();
  return useSyncExternalStore(
    store ? store.subscribe : NO_SUBSCRIBE,
    store ? store.getActiveHandles : NO_HANDLES_SNAPSHOT,
    store ? store.getActiveHandles : NO_HANDLES_SNAPSHOT,
  );
}
