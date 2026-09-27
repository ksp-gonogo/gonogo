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

/**
 * Takes the named augments and contributions out of their registries, keeping
 * every other entry in its order, and returns what puts them back.
 *
 * Neither registry drops a single id, so each is emptied and refilled from the
 * definitions it held, which both accept as fresh registrations.
 */
export function withholdExtensions(ids: readonly string[]): () => void {
  if (ids.length === 0) return () => {};
  const withheld = new Set(ids);
  const augments = getAugments();
  const contributions = getContributions();
  refill(augments, contributions, (id) => !withheld.has(id));
  return () => refill(augments, contributions, () => true);
}

function refill(
  augments: ReturnType<typeof getAugments>,
  contributions: ReturnType<typeof getContributions>,
  keep: (id: string) => boolean,
): void {
  clearAugments();
  for (const def of augments) {
    if (keep(def.id)) registerAugment(def as never);
  }
  clearContributions();
  for (const def of contributions) {
    if (keep(def.id)) registerContribution(def);
  }
}
