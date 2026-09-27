import { value } from "@ksp-gonogo/sitrep-sdk";
import { writeQuantity } from "@ksp-gonogo/ui-kit";
import type { TechNode } from "./wire";

export interface UnlockContext {
  researchable: Set<string>;
  chargesScience: boolean;
  unlockBlocked: boolean;
  sciAvailable: number | null;
  careerNotCurrent: boolean;
}

export interface UnlockHandlers {
  isResearchable: boolean;
  canAfford: boolean;
  moneyDecides: boolean;
  canUnlock: boolean;
  affordTooltip?: string;
}

function priceTooltip(
  n: TechNode,
  sciAvailable: number | null,
  careerNotCurrent: boolean,
): string {
  if (n.scienceCost === null) return "No price reported for this node";
  const need = () => writeQuantity(value("science", n.scienceCost as number));
  if (sciAvailable === null) {
    if (careerNotCurrent) {
      return `Need ${need()} (affordability cannot be checked against a held balance)`;
    }
    return `Need ${need()} (no science balance has arrived)`;
  }
  return `Need ${need()} (have ${sciAvailable})`;
}

// A career model that refuses `career.tech.unlock` (RP-1 researches through its own queue) refuses for a reason the balance has no part in, so no affordability verdict is drawn.
export function unlockHandlersFor(
  n: TechNode,
  ctx: UnlockContext,
): UnlockHandlers {
  const isResearchable = ctx.researchable.has(n.id);
  // Sandbox charges nothing, so the balance gates only where science is spent.
  const judged = ctx.chargesScience && !ctx.unlockBlocked;
  // Fails closed: an absent or held balance arms nothing.
  const canAfford =
    !judged ||
    (ctx.sciAvailable !== null &&
      n.scienceCost !== null &&
      ctx.sciAvailable >= n.scienceCost);
  // A verdict is drawn only against a current balance, since a held or absent one can say neither yes nor no.
  const moneyDecides = judged && ctx.sciAvailable !== null;
  const canUnlock = isResearchable && canAfford;
  if (!canAfford) {
    return {
      isResearchable,
      canAfford,
      moneyDecides,
      canUnlock,
      affordTooltip: priceTooltip(n, ctx.sciAvailable, ctx.careerNotCurrent),
    };
  }
  return { isResearchable, canAfford, moneyDecides, canUnlock };
}
