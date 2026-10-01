import { createContext, useContext } from "react";
import type { UseCommandResult } from "./use-command";

/** One command handle as the rail holds it, keyed by an id stable for the registering hook's life. */
export type RailedCommand = Omit<UseCommandResult, "send" | "gateFor"> & {
  id: string;
};

/**
 * Where a widget's live command handles are collected for the panel's delay
 * rail to draw: in flight, refused, lost, found and never sent. `useCommand`
 * registers every handle it returns with the nearest one, so a command's
 * outcome is shown without the widget wiring anything.
 */
export interface RailRegistry {
  /** Add or replace a handle, keyed on its `id`. Returns its deregister function. */
  register(entry: RailedCommand): () => void;
  /** Update a registered handle in place; a no-op when nothing moved. */
  update(id: string, next: Omit<RailedCommand, "id">): void;
}

/** The nearest rail, or `null` where none is mounted. */
export const RailRegistryContext = createContext<RailRegistry | null>(null);

export function useRailRegistry(): RailRegistry | null {
  return useContext(RailRegistryContext);
}
