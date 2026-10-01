import type { TechNode } from "./wire";

export interface UnlockContext {
  researchable: Set<string>;
  chargesScience: boolean;
  unlockBlocked: boolean;
  sciAvailable: number | null;
}

/** What a node's price readout claims about the science balance. Whether Unlock is available is the command's gate, never this. */
export interface UnlockHandlers {
  isResearchable: boolean;
  canAfford: boolean;
  moneyDecides: boolean;
}

// A career model that refuses `career.tech.unlock` (one that researches through a queue of its own) refuses for a reason the balance has no part in, so no affordability verdict is drawn.
export function unlockHandlersFor(
  n: TechNode,
  ctx: UnlockContext,
): UnlockHandlers {
  const isResearchable = ctx.researchable.has(n.id);
  // Sandbox charges nothing, so the balance gates only where science is spent.
  const judged = ctx.chargesScience && !ctx.unlockBlocked;
  // Fails closed: an absent or held balance reads as unaffordable.
  const canAfford =
    !judged ||
    (ctx.sciAvailable !== null &&
      n.scienceCost !== null &&
      ctx.sciAvailable >= n.scienceCost);
  // A verdict is drawn only against a current balance, since a held or absent one can say neither yes nor no.
  const moneyDecides = judged && ctx.sciAvailable !== null;
  return { isResearchable, canAfford, moneyDecides };
}
