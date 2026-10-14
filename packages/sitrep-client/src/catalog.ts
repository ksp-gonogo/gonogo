import { CatalogContact, type CatalogEntry } from "@ksp-gonogo/sitrep-sdk";
import { wireMagnitude } from "./wire-magnitude";

/**
 * Where a craft stands with the command centre a catalog belongs to, for
 * display: in contact, silent with no expected return, silent and due back,
 * overdue, declared lost, or known gone.
 */
export type ContactPhase =
  | "nominal"
  | "waiting"
  | "expected"
  | "overdue"
  | "lost"
  | "gone";

/** The instant this centre expects to hear the silent craft again, or null when it expects nothing. */
export function expectedReturnUt(
  entry: Pick<CatalogEntry, "expectedReturnUt"> | undefined,
): number | null {
  return wireMagnitude(entry?.expectedReturnUt);
}

/**
 * The craft's contact phase at `nowUt`, or undefined when no word of a route
 * to it has reached the centre. A silent craft goes overdue on the view clock
 * once its overdue instant passes, without waiting for the next catalog.
 */
export function contactPhase(
  entry:
    | Pick<CatalogEntry, "contact" | "expectedReturnUt" | "overdueAfterUt">
    | undefined,
  nowUt: number,
): ContactPhase | undefined {
  const contact = entry?.contact;
  if (contact == null) return undefined;
  switch (contact) {
    case CatalogContact.InContact:
      return "nominal";
    case CatalogContact.Lost:
      return "lost";
    case CatalogContact.Gone:
      return "gone";
    case CatalogContact.Overdue:
      return "overdue";
    case CatalogContact.Silent: {
      if (expectedReturnUt(entry) == null) return "waiting";
      const overdueAfter = wireMagnitude(entry?.overdueAfterUt);
      return overdueAfter != null && nowUt > overdueAfter
        ? "overdue"
        : "expected";
    }
    default: {
      const unruled: never = contact;
      void unruled;
      return undefined;
    }
  }
}

/** How long past its expected return an overdue craft is, in seconds, or undefined when it is not overdue. */
export function overdueSeconds(
  entry:
    | Pick<CatalogEntry, "contact" | "expectedReturnUt" | "overdueAfterUt">
    | undefined,
  nowUt: number,
): number | undefined {
  if (contactPhase(entry, nowUt) !== "overdue") return undefined;
  const expected = expectedReturnUt(entry);
  return expected == null ? undefined : nowUt - expected;
}
