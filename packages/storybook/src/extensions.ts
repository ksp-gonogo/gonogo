import {
  clearContributions,
  getContributions,
  registerContribution,
} from "@ksp-gonogo/sitrep-sdk/spine";
import {
  clearAugments,
  getAugments,
  registerAugment,
} from "@ksp-gonogo/ui-kit";

/** How many live scenes withheld each augment or contribution id. */
const withheld = new Map<string, number>();

/** Both registries as they stood before the first withheld id, refilled from while any id is out. */
let unwithheld:
  | {
      augments: ReturnType<typeof getAugments>;
      contributions: ReturnType<typeof getContributions>;
    }
  | undefined;

/**
 * Takes the named augments and contributions out of their registries, keeping
 * every other entry in its order, and returns what puts them back.
 *
 * Neither registry drops a single id, so each is emptied and refilled from the
 * definitions it held, which both accept as fresh registrations. The registries
 * are page-wide: an id stays out of every scene on the page until the last
 * scene that withheld it puts it back.
 */
export function withholdExtensions(ids: readonly string[]): () => void {
  if (ids.length === 0) return () => {};
  unwithheld ??= {
    augments: getAugments(),
    contributions: getContributions(),
  };
  for (const id of ids) withheld.set(id, (withheld.get(id) ?? 0) + 1);
  refill();
  let restored = false;
  return () => {
    if (restored) return;
    restored = true;
    for (const id of ids) {
      const left = (withheld.get(id) ?? 1) - 1;
      if (left === 0) withheld.delete(id);
      if (left > 0) withheld.set(id, left);
    }
    refill();
  };
}

function refill(): void {
  const all = unwithheld;
  if (!all) return;
  clearAugments();
  for (const def of all.augments) {
    if (!withheld.has(def.id)) registerAugment(def as never);
  }
  clearContributions();
  for (const def of all.contributions) {
    if (!withheld.has(def.id)) registerContribution(def);
  }
  if (withheld.size === 0) unwithheld = undefined;
}
