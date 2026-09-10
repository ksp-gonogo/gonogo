import { useSyncExternalStore } from "react";
import { createPanelStore } from "../store/createPanelStore";
import { createStore } from "../store/createStore";
import type { CommandDelayHandle } from "./CommandDelay";

/**
 * One command's delay-output registration into the Panel-scoped rail.
 * Extends the structural `CommandDelayHandle` shape `<CommandDelay>` already
 * renders with a stable `id`, so the registry can key register/update/deregister
 * without relying on object identity (a command widget's handle is a fresh
 * object literal on most renders). The `id` is minted by `usePanelDelay`
 * (`useId`), never by the widget.
 */
export interface CommandHandle extends CommandDelayHandle {
  /** Stable for the registering hook's whole mounted life. */
  id: string;
}

/**
 * A per-panel, off-tree registry of active command handles, the generic
 * `createStore` renamed to the rail's vocabulary (`getActiveHandles` is its
 * snapshot). `update` keeps a registered handle current in place, so
 * `usePanelDelay` never has to deregister/re-register on a value change.
 *
 * HARD RULE from the design applies verbatim: the live handle data lives in the
 * store, never in a React context value, so a registration change re-renders
 * only the rail's subscribers, not every widget in the tree.
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
 * Carries only the store HANDLE, never the live registrations, same placement
 * as `PanelStatusStore`'s context. `null` outside a `Panel` (or a test with no
 * provider), where `usePanelDelay` and `useActiveHandles` both degrade to a
 * no-op.
 *
 * Exported raw so `Panel` (or a test seeding a store) can render
 * `<DelayRailContext.Provider value={store}>` with a store whose lifetime it
 * owns; `DelayRailProvider` is the common case that mints and holds one itself.
 */
export const DelayRailContext = DelayPanelStore.Context;

/** Mints one delay store and holds it for its whole life, for a `Panel` that
 * does not need to own the store's lifetime itself. */
export const DelayRailProvider = DelayPanelStore.Provider;

/**
 * The nearest store, or `null` outside a `Panel`. `usePanelDelay`'s
 * registration effect reads this directly (not `useActiveHandles`, which
 * subscribes and re-renders on every registration change: a registering
 * command widget has no reason to re-render when a sibling command registers).
 */
export const useDelayRailStore = DelayPanelStore.useStore;

// Shared, stable no-store fallbacks so `getSnapshot` returns a referentially
// stable value with no provider in the tree; a fresh `[]` / closure here would
// make `useSyncExternalStore` believe the snapshot changes on every render and
// loop forever.
const NO_SUBSCRIBE = (): (() => void) => () => {};
const NO_HANDLES: readonly CommandHandle[] = [];
const NO_HANDLES_SNAPSHOT = (): readonly CommandHandle[] => NO_HANDLES;

/**
 * The panel's active command handles, or `[]` when the store is empty or there
 * is no store in the tree. `useSyncExternalStore` over the nearest
 * `DelayRailStore`, so a subscriber (`Panel.Delay`) re-renders only when the
 * active handle set changes.
 */
export function useActiveHandles(): readonly CommandHandle[] {
  const store = useDelayRailStore();
  return useSyncExternalStore(
    store ? store.subscribe : NO_SUBSCRIBE,
    store ? store.getActiveHandles : NO_HANDLES_SNAPSHOT,
    store ? store.getActiveHandles : NO_HANDLES_SNAPSHOT,
  );
}
