import { createContext, useContext } from "react";
import type { ContributionSlotId } from "./contributions";

/**
 * The identity and declared contribution slots of the widget the caller is
 * rendered inside. {@link ContributionsProvider} reads it to know which slots
 * to serve, and segment slots complete to `${componentId}.<segment>` from it.
 *
 * @category Extensions
 */
export interface WidgetMetaContextValue {
  /** The widget's registered component id. */
  componentId: string;
  /** The contribution slots the widget declares in its `contributionSlots`, or an empty list. */
  contributionSlots: readonly ContributionSlotId[];
}

/**
 * The context carrying {@link WidgetMetaContextValue} for the current widget,
 * `null` outside one. The dashboard provides it for every widget; a test
 * rendering a widget bare provides it to get the widget's slots working.
 *
 * @category Extensions
 */
export const WidgetMetaContext = createContext<WidgetMetaContextValue | null>(
  null,
);

/**
 * The current widget's identity and declared contribution slots, or `null`
 * outside a {@link WidgetMetaContext} provider (a widget rendered bare, a panel
 * outside the dashboard).
 *
 * @category Extensions
 */
export function useWidgetMeta(): WidgetMetaContextValue | null {
  return useContext(WidgetMetaContext);
}
