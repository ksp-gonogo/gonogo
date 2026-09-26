import { ContributionsProvider } from "@ksp-gonogo/core";
import { type ContributionSlotId, WidgetMetaContext } from "@ksp-gonogo/ui-kit";
import type { ReactNode } from "react";

/**
 * The two providers the dashboard puts round every widget, for a test
 * rendering one on its own. Without them a contribution slot is silently
 * empty and the widget renders nothing, which reads as a telemetry problem.
 */
export function ContributionHost({
  children,
  componentId,
  contributionSlots,
}: {
  children: ReactNode;
  componentId: string;
  /* Typed as registry slot ids, so an id that does not exist fails here rather than at an empty render. */
  contributionSlots: readonly ContributionSlotId[];
}) {
  return (
    <WidgetMetaContext.Provider value={{ componentId, contributionSlots }}>
      <ContributionsProvider>{children}</ContributionsProvider>
    </WidgetMetaContext.Provider>
  );
}
