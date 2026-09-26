import { createContext, useContext } from "react";
import type { ContributionSlotId } from "./contributions";

/**
 * Identity and declared contribution slots for the widget instance the caller
 * is mounted inside, so ContributionsProvider knows which slots to aggregate.
 * Mounted by the dashboard orchestrator.
 */
export interface WidgetMetaContextValue {
  /** The registered ComponentDefinition.id of the mounted widget. */
  componentId: string;
  /** The widget's own declared ComponentDefinition.contributionSlots, or []. */
  contributionSlots: readonly ContributionSlotId[];
}

export const WidgetMetaContext = createContext<WidgetMetaContextValue | null>(
  null,
);

/** Null outside a provider: a bare widget, a test, or a panel outside the dashboard. */
export function useWidgetMeta(): WidgetMetaContextValue | null {
  return useContext(WidgetMetaContext);
}
