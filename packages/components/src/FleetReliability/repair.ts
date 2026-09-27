import type {
  CrewMember,
  InventoryStore,
  RepairCostItem,
} from "@ksp-gonogo/sitrep-sdk";
import { magnitudeOf } from "@ksp-gonogo/ui-kit";

/** One line of a repair's stated cost; `label` is the item's display title where known, its config id otherwise. */
export interface CostLine {
  name: string;
  label: string;
  needed: number;
  carried: number;
  reserve: number;
}

/** How many of one item this kerbal carries, joined on the id the provider stated on `repairCost`. */
export function carriedOf(member: CrewMember, itemName: string): number {
  let held = 0;
  for (const item of member.carrying ?? []) {
    if (item.name === itemName) held += magnitudeOf(item.quantity) ?? 0;
  }
  return held;
}

/** The conditions a repair action applies to: a service-due part is cleared by the same command. */
export function actionable(condition: string | null | undefined): boolean {
  return (
    condition === "failed" ||
    condition === "failed-critical" ||
    condition === "service-due"
  );
}

/** `Repair` for a failure, `Service` for a part that is merely due one. */
export function verbFor(condition: string | null | undefined): string {
  return condition === "service-due" ? "Service" : "Repair";
}

/**
 * Whether the provider will accept this kerbal for this part, off the
 * requirement it stated: an empty trait means anyone, comma-separated traits
 * mean any of them. Filtering spares the operator a round trip to a known
 * refusal.
 */
export function mayAct(
  member: CrewMember,
  trait: string | null | undefined,
  level: number | null | undefined,
): boolean {
  if (trait) {
    const accepted = trait.split(",").map((t) => t.trim().toLowerCase());
    if (!accepted.includes((member.trait ?? "").toLowerCase())) return false;
  }
  if (level != null && (magnitudeOf(member.experienceLevel) ?? 0) < level) {
    return false;
  }
  return true;
}

/**
 * The provider's stated cost for a part, resolved against the vessel; an empty
 * cost draws no ledger and gates nothing.
 */
export function repairCostResolver(
  crew: CrewMember[],
  stores: readonly InventoryStore[],
): (part: { repairCost?: RepairCostItem[] | null }) => CostLine[] {
  // The reserve a fetch could reach: part-hosted only, since no backend takes an item from another kerbal's pocket.
  const aboard = new Map<string, { quantity: number; title?: string | null }>();
  for (const store of stores) {
    for (const item of store.items ?? []) {
      const seen = aboard.get(item.name);
      aboard.set(item.name, {
        quantity: (seen?.quantity ?? 0) + (magnitudeOf(item.quantity) ?? 0),
        title: seen?.title ?? item.title,
      });
    }
  }
  /** The title anything aboard gives this item id, crew pockets included. */
  const titleOf = (name: string): string | undefined => {
    const stored = aboard.get(name)?.title;
    if (stored) return stored;
    for (const member of crew) {
      for (const item of member.carrying ?? []) {
        if (item.name === name && item.title) return item.title;
      }
    }
    return undefined;
  };
  return (part) =>
    (part.repairCost ?? []).map((item) => ({
      name: item.name,
      label: titleOf(item.name) ?? item.name,
      needed: magnitudeOf(item.quantity) ?? 0,
      carried: 0,
      reserve: aboard.get(item.name)?.quantity ?? 0,
    }));
}
