import { createContext, useContext, useLayoutEffect } from "react";

/**
 * Something a widget uses that the save may not have unlocked: a Topic it reads
 * or a command it holds. Useful for refusing a widget when the career has not
 * yet unlocked what it needs. Taken by `LockScopeRegistry` and
 * `useClaimCapability`.
 *
 * @category Readings
 */
export type Capability =
  | {
      /** A Topic. */
      kind: "topic";
      /** The Topic id. */
      id: string;
    }
  | {
      /** A command. */
      kind: "command";
      /** The command id. */
      id: string;
    };

/**
 * Collects the capabilities that a part of the tree uses, so the part can refuse
 * itself when one is locked. Useful for showing the operator that a widget is
 * locked instead of an empty widget. Supplied by {@link LockScope}.
 *
 * `useTelemetry`, `useStream` and `useCommand` claim what they are given with
 * the nearest scope, so a widget cannot leave out something it reads or holds
 * by forgetting to declare it.
 */
export interface LockScopeRegistry {
  /** Records a capability as used here. Returns its release. */
  claim(capability: Capability): () => void;
  /**
   * Hears a capability claimed in a scope nested inside this one, without
   * counting it toward this scope's lock. Only a scope that records what a
   * subtree uses needs it, so a scope may leave it out.
   */
  observe?(capability: Capability): void;
}

/**
 * The nearest lock scope, or `null` where none is mounted. Useful for reading
 * which capabilities a part of the tree has claimed. Provided by {@link LockScope} and
 * read by `useClaimCapability`.
 */
export const LockScopeContext = createContext<LockScopeRegistry | null>(null);

/**
 * Claims the capability named by `kind` and `id` with the nearest lock scope for
 * as long as the caller is mounted. Useful for a widget that must refuse itself
 * while what it reads or sends is locked. Used by the guard widgets that wrap
 * content requiring a Topic.
 */
export function useClaimCapability(kind: Capability["kind"], id: string): void {
  const scope = useContext(LockScopeContext);
  // A layout effect, so a scope that locks on this claim does so before the first paint.
  useLayoutEffect(() => scope?.claim({ kind, id }), [scope, kind, id]);
}
