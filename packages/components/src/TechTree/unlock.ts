import { value } from "@ksp-gonogo/sitrep-sdk";
import { writeQuantity } from "@ksp-gonogo/ui-kit";
import type { TechNode } from "./wire";

export interface UnlockContext {
  researchable: Set<string>;
  chargesScience: boolean;
  unlockBlocked: boolean;
  sciAvailable: number | null;
  careerNotCurrent: boolean;
  upgradesEnabled: boolean;
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
  // Absent science reads as insufficient science; sandbox charges nothing.
  const moneyDecides = ctx.chargesScience && !ctx.unlockBlocked;
  const canAfford =
    !moneyDecides ||
    (ctx.sciAvailable !== null &&
      n.scienceCost !== null &&
      ctx.sciAvailable >= n.scienceCost);
  const canUnlock = isResearchable && canAfford && ctx.upgradesEnabled;
  if (!canAfford) {
    return {
      isResearchable,
      canAfford,
      moneyDecides,
      canUnlock,
      affordTooltip: priceTooltip(n, ctx.sciAvailable, ctx.careerNotCurrent),
    };
  }
  if (!ctx.upgradesEnabled) {
    return {
      isResearchable,
      canAfford,
      moneyDecides,
      canUnlock,
      affordTooltip: "Unlock from the Space Center scene",
    };
  }
  return { isResearchable, canAfford, moneyDecides, canUnlock };
}
