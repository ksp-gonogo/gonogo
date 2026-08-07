import { createContext, useContext } from "react";
import type { ContributionSlotId } from "../contributions";

/**
 * Identity + declared contribution slots for the widget instance the
 * calling component is mounted inside. Returns null outside a provider (a
 * bare widget/test, or a panel outside the dashboard), same posture as most
 * of this package's optional context hooks. Mounted by the orchestrator
 * (GridItemContent, Task 1.5), next to DashboardItemContext, so
 * ContributionsProvider knows which slots to aggregate for this widget
 * without a second prop threaded everywhere.
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

export function useWidgetMeta(): WidgetMetaContextValue | null {
  return useContext(WidgetMetaContext);
}
