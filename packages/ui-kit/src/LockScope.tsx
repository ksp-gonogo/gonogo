import {
  type CapabilityLock,
  LockScopeContext,
  lockSentence,
  useLockScope,
} from "@ksp-gonogo/sitrep-sdk/spine";
import type { ReactElement, ReactNode } from "react";
import { InactiveNotice } from "./InactiveNotice";
import { writeQuantity } from "./units";

/**
 * What a locked {@link LockScope} hands its `fallback`: the sentence every lock
 * notice reads, and the locks behind it.
 *
 * @category Panel
 */
export interface LockSummary {
  /** "Missing tech: Flight Control", or a building's name such as "Mission Control". */
  reason: string;
  /** "45 science to research", or "Needs Building level 2". */
  hint?: string;
  locks: readonly CapabilityLock[];
}

/**
 * Props for {@link LockScope}.
 *
 * @category Panel
 */
export interface LockScopeProps {
  children?: ReactNode;
  /**
   * What draws in place of `children` while a capability used here is one this
   * save has not unlocked. Defaults to the centred inactive notice; `null`
   * draws nothing, for a scope that is an overlay or a badge.
   */
  fallback?: ReactNode | ((lock: LockSummary) => ReactNode);
}

/** A quantity in a lock sentence, written the way the kit writes every other one. */
function writeLockQuantity(
  quantity: { magnitude: number; unit: string } | number,
  unit: string,
): string {
  return writeQuantity(
    typeof quantity === "number" ? { magnitude: quantity, unit } : quantity,
  );
}

/**
 * Marks a part of the tree as a lock scope. A topic read or a command held
 * anywhere inside it, through `useTelemetry`, `useStream` or `useCommand`,
 * that this save has not unlocked replaces the whole scope with its
 * `fallback`. The innermost scope wins, so a scope inside a section takes the
 * lock instead of the section.
 *
 * Draws no element of its own. `Section`, each augment in an `AugmentSlot` and
 * the dashboard's widget guard are lock scopes already; wrap anything else
 * that should stand or fall on its own.
 *
 * @category Panel
 */
export function LockScope({
  children,
  fallback,
}: LockScopeProps): ReactElement {
  const { scope, locks } = useLockScope();
  if (locks.length > 0) {
    const summary: LockSummary = {
      ...lockSentence(locks, writeLockQuantity),
      locks,
    };
    const drawn =
      fallback === undefined ? (
        <InactiveNotice reason={summary} />
      ) : typeof fallback === "function" ? (
        fallback(summary)
      ) : (
        fallback
      );
    return <>{drawn}</>;
  }
  return (
    <LockScopeContext.Provider value={scope}>
      {children}
    </LockScopeContext.Provider>
  );
}
