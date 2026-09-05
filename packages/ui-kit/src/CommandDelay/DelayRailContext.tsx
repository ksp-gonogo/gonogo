import { useSyncExternalStore } from "react";
import { createPanelStore } from "../store/createPanelStore";
import { createStore } from "../store/createStore";
import type { CommandDelayHandle } from "./CommandDelay";
import type { RailTags } from "./railTags";

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
 * One tagged NON-command crossing registered into the same rail: a thing that
 * occupies the gap without being a dispatch awaiting an ack.
 *
 * Kept a separate registration rather than another `CommandHandle` shape,
 * because a crossing has none of a command's parts. There is no `inFlight`, no
 * refusal, no loss, no must-consume token and nothing to dismiss; a handle
 * carrying all of those as empties would be claiming a command's guarantees
 * while providing none of them, which is the exact confusion `RailTags` exists
 * to end.
 */
export interface CrossingHandle {
  /** Stable for the registering hook's whole mounted life. */
  id: string;
  /** The three axes. What the rail draws follows entirely from these. */
  tags: RailTags;
  /** The graphic's accessible name, e.g. "Your transmission crossing to Odyssey". */
  label: string;
  /** Waveform samples, 0..1 each, NEWEST LAST. Read only for a continuous entry. */
  amplitudes?: readonly number[];
  /** How many samples span the trip to the boundary (one light-time). */
  spanSamples?: number;
  /** For a discrete entry: 0 at this end, 1 at the far end of the drawn journey. */
  progress?: number;
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
  /** Add or replace a tagged crossing (keyed on `entry.id`). Returns its deregister function. */
  registerCrossing(entry: CrossingHandle): () => void;
  /** Update a registered crossing's non-id fields in place. */
  updateCrossing(id: string, next: Omit<CrossingHandle, "id">): void;
  /** Subscribe to any change in the active crossing set. Returns unsubscribe. */
  subscribeCrossings(onChange: () => void): () => void;
  /** The current active crossings, insertion-ordered, stable while unchanged. */
  getActiveCrossings(): readonly CrossingHandle[];
}

export function createDelayRailStore(): DelayRailStore {
  const base = createStore<CommandHandle>();
  /*
   * A second store rather than a second entry TYPE in the first, so their
   * listener sets are separate: a voice ribbon updating fifty times a second
   * has no business re-rendering a command subscriber that reads neither its
   * amplitudes nor its tags.
   */
  const crossings = createStore<CrossingHandle>();
  return {
    register: base.register,
    update: base.update,
    subscribe: base.subscribe,
    getActiveHandles: base.getSnapshot,
    registerCrossing: crossings.register,
    updateCrossing: crossings.update,
    subscribeCrossings: crossings.subscribe,
    getActiveCrossings: crossings.getSnapshot,
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

const NO_CROSSINGS: readonly CrossingHandle[] = [];
const NO_CROSSINGS_SNAPSHOT = (): readonly CrossingHandle[] => NO_CROSSINGS;

/**
 * The panel's active tagged crossings, or `[]` with none registered and none
 * possible. The crossing twin of `useActiveHandles`, on the crossing store's
 * own listener set.
 */
export function useActiveCrossings(): readonly CrossingHandle[] {
  const store = useDelayRailStore();
  return useSyncExternalStore(
    store ? store.subscribeCrossings : NO_SUBSCRIBE,
    store ? store.getActiveCrossings : NO_CROSSINGS_SNAPSHOT,
    store ? store.getActiveCrossings : NO_CROSSINGS_SNAPSHOT,
  );
}
