import { createContext, useContext } from "react";
import type { UseCommandResult } from "./use-command";

/**
 * One command handle as the rail holds it, keyed by an id stable for the
 * registering hook's life. Useful for drawing a command's outcome without the
 * widget wiring anything. Held by {@link RailRegistry}.
 */
export type RailedCommand = Omit<
  UseCommandResult,
  "send" | "gateFor" | "railed"
> & {
  id: string;
};

/**
 * Where a widget's live command handles are collected for the panel's delay rail
 * to draw: in flight, refused, lost, found and never sent. Useful for showing the
 * operator a command's outcome without the widget wiring anything. Used by the
 * panel's delay rail; `useCommand` registers every handle it returns with the
 * nearest one.
 */
export interface RailRegistry {
  /** Add or replace a handle, keyed on its `id`. Returns its deregister function. */
  register(entry: RailedCommand): () => void;
  /** Update a registered handle in place; a no-op when nothing moved. */
  update(id: string, next: Omit<RailedCommand, "id">): void;
}

/**
 * The nearest rail registry, or `null` where none is mounted. Useful for a
 * command hook to find the panel whose delay rail should show its commands.
 * Provided by the panel's delay rail and read through `useRailRegistry`, which
 * `useCommand` calls.
 */
export const RailRegistryContext = createContext<RailRegistry | null>(null);

export function useRailRegistry(): RailRegistry | null {
  return useContext(RailRegistryContext);
}
