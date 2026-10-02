import { createContext, useContext, useLayoutEffect } from "react";

/** Something a widget uses that the save may not have unlocked: a topic it reads or a command it holds. */
export type Capability =
  | { kind: "topic"; id: string }
  | { kind: "command"; id: string };

/**
 * Where the capabilities a part of the tree uses are collected, so the part
 * can refuse itself when one is locked. `useTelemetry`, `useStream` and
 * `useCommand` claim what they are given with the nearest scope, so nothing a
 * widget reads or holds can be left out by forgetting to declare it.
 */
export interface LockScopeRegistry {
  /** Records a capability as used here. Returns its release. */
  claim(capability: Capability): () => void;
}

/** The nearest lock scope, or `null` where none is mounted. */
export const LockScopeContext = createContext<LockScopeRegistry | null>(null);

/** Claims `capability` with the nearest lock scope for as long as the caller is mounted. */
export function useClaimCapability(kind: Capability["kind"], id: string): void {
  const scope = useContext(LockScopeContext);
  // A layout effect, so a scope that locks on this claim does so before the first paint.
  useLayoutEffect(() => scope?.claim({ kind, id }), [scope, kind, id]);
}
