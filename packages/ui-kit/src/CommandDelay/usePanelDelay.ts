import { useEffect, useId } from "react";
import type { CommandDelayHandle } from "./CommandDelay";
import { useDelayRailStore } from "./DelayRailContext";

/**
 * Publish a command's delay handle to the nearest `DelayRailProvider` for the
 * life of the calling component, so the panel's rail renders its delay UX. A
 * widget calls `useCommand(...)` and hands the result to `usePanelDelay(cmd)`.
 *
 * - registers on mount, deregisters on unmount, `update`s in place on a value
 *   change
 * - a no-op when there is no store in the tree
 * - the registry `id` is minted here with `useId`, since a handle is a fresh
 *   object on most renders
 * - `null` contributes nothing, so a widget can pass the handle conditionally
 * - consumes the command's dev-only must-consume token, so a delayed command
 *   can never dispatch without its delay UX wired
 */
export function usePanelDelay(handle: CommandDelayHandle | null): void {
  const store = useDelayRailStore();
  const id = useId();
  const present = handle !== null;

  // Keyed on identity only, so a value change updates in place rather than re-registering.
  // biome-ignore lint/correctness/useExhaustiveDependencies: value changes are applied by the update effect, not by re-registering
  useEffect(() => {
    if (!store || !handle) return;
    return store.register({ id, ...handle });
  }, [store, id, present]);

  // The store's shallow-equal guard means a handle that did not actually move notifies nobody.
  useEffect(() => {
    if (!store || !handle) return;
    store.update(id, handle);
  }, [store, id, handle]);

  /*
   * Marked in RENDER, not an effect: this hook runs after `useCommand` in the
   * same component, so an effect would fire after `useCommand`'s dispatch
   * check and a command dispatched on mount would trip it. Marked with or
   * without a store, since calling this hook IS wiring the delay UX.
   */
  if (process.env.NODE_ENV !== "production" && handle?._output) {
    handle._output.consumed = true;
  }
}
