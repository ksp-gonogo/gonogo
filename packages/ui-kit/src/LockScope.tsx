import {
  type CapabilityLock,
  LockScopeContext,
  lockSentence,
  useLockScope,
} from "@ksp-gonogo/sitrep-sdk/spine";
import type { ReactElement, ReactNode } from "react";
import { InactiveNotice } from "./InactiveNotice";
import { writeLockQuantity } from "./lockQuantity";

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
  /** Every lock the summary was made from. Each is `{ capability, missing, detail? }`: the capability that is locked, the unlocks it still needs, and a sentence for when it names none. */
  locks: readonly CapabilityLock[];
}

/**
 * Props for {@link LockScope}.
 *
 * @category Panel
 */
export interface LockScopeProps {
  /** The content the scope guards, drawn while nothing used inside it is locked. */
  children?: ReactNode;
  /**
   * What draws in place of `children` while something used inside the scope
   * is not unlocked in this save. Given a function, it is called with the
   * {@link LockSummary}. Defaults to a centred notice of the reason; `null`
   * draws nothing, for a scope that is an overlay or a badge.
   */
  fallback?: ReactNode | ((lock: LockSummary) => ReactNode);
}

/**
 * Marks a part of the tree that stands or falls together. When anything
 * inside it reads a Topic (with `useTelemetry` or `useStream`) or uses a
 * command (with `useCommand`) that this save has not unlocked (a technology
 * not yet researched, or a building not yet upgraded, in a career save), the
 * whole scope is replaced by its `fallback`. The innermost scope wins, so a scope inside a
 * section is replaced while the section stays.
 *
 * It draws no element of its own. A {@link Section}, each augment an
 * {@link AugmentSlot} renders, and every widget as a whole are lock scopes
 * already; wrap anything else that should be replaced on its own.
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
