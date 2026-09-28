import { useEffect, useId } from "react";
import type { CommandDelayHandle } from "./CommandDelay";
import { useDelayRailStore } from "./DelayRailContext";

/**
 * Something the rail draws that is not a command, such as an open microphone's
 * ribbon. A command handle is registered by `useCommand` itself, so one passed
 * here is a type error rather than a second entry.
 *
 * @category Command delay
 */
export type RailEntry = CommandDelayHandle & { send?: never };

/**
 * Put a non-command entry on the nearest panel's delay rail for the life of the
 * calling component, updating it in place as it changes. `null` contributes
 * nothing, so an entry can come and go; outside a rail it is a no-op.
 *
 * @category Command delay
 */
export function useRailEntry(entry: RailEntry | null): void {
  const store = useDelayRailStore();
  const id = useId();
  const present = entry !== null;

  // Keyed on identity only, so a value change updates in place rather than re-registering.
  // biome-ignore lint/correctness/useExhaustiveDependencies: value changes are applied by the update effect, not by re-registering
  useEffect(() => {
    if (!store || !entry) return;
    return store.register({ id, ...entry });
  }, [store, id, present]);

  // The store's shallow-equal guard means an entry that did not actually move notifies nobody.
  useEffect(() => {
    if (!store || !entry) return;
    store.update(id, entry);
  }, [store, id, entry]);
}
