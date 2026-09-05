import { useEffect, useId } from "react";
import type { CrossingHandle } from "./DelayRailContext";
import { useDelayRailStore } from "./DelayRailContext";

/**
 * Publish a tagged crossing into the nearest rail for the life of the calling
 * component, so `Panel.Delay` draws it beside the panel's commands. The
 * non-command twin of `usePanelDelay`, and deliberately the same shape: a
 * widget hands it a value, `null` contributes nothing, and the whole thing is a
 * no-op with no store in the tree.
 *
 * The differences from `usePanelDelay` are the two a crossing does not have.
 * There is no must-consume token to mark, because a crossing is not a dispatch
 * that could be made without its delay UX; and the registration is keyed on a
 * `useId` for the same reason the command one is, a caller's handle being a
 * fresh literal on most renders.
 *
 * A live one updates fast (the voice ribbon lands a sample every 20 ms), which
 * is why the value change goes through `update` rather than a re-registration:
 * the store's shallow-equal guard notifies only its own crossing subscribers,
 * and a panel full of command widgets re-renders none of them.
 */
export function usePanelCrossing(
  crossing: Omit<CrossingHandle, "id"> | null,
): void {
  const store = useDelayRailStore();
  const id = useId();
  const present = crossing !== null;

  // Register / deregister on identity only (the store, the minted id, whether
  // there is anything to draw). Value changes are applied by the effect below,
  // so a sample arriving does not tear the entry down and rebuild it.
  // biome-ignore lint/correctness/useExhaustiveDependencies: value changes are applied by the update effect, not by re-registering
  useEffect(() => {
    if (!store || !crossing) return;
    return store.registerCrossing({ id, ...crossing });
  }, [store, id, present]);

  useEffect(() => {
    if (!store || !crossing) return;
    store.updateCrossing(id, crossing);
  }, [store, id, crossing]);
}
