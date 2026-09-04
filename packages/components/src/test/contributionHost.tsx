import { ContributionsProvider } from "@ksp-gonogo/core";
import { type ContributionSlotId, WidgetMetaContext } from "@ksp-gonogo/ui-kit";
import type { ReactNode } from "react";

/**
 * The two providers the dashboard puts round every widget
 * (`GridItemContent.tsx`), for a test that renders one on its own.
 *
 * A widget reading its own data through a contribution slot needs both, and
 * without them the slot is silently empty: `useContributions` has no store to
 * read and `ContributionsProvider` has no meta saying which slots to aggregate.
 * The result is a widget that renders and shows nothing, which looks like a
 * telemetry problem rather than a missing harness.
 */
export function ContributionHost({
  children,
  componentId,
  contributionSlots,
}: {
  children: ReactNode;
  componentId: string;
  /* The slot ids the widget declares, in the registry's own vocabulary rather
     than as bare strings: typed this way the value IS a `WidgetMetaContextValue`
     and needs no assertion to become one, and a slot id that does not exist
     fails here rather than at the empty render it would otherwise cause. */
  contributionSlots: readonly ContributionSlotId[];
}) {
  return (
    <WidgetMetaContext.Provider value={{ componentId, contributionSlots }}>
      <ContributionsProvider>{children}</ContributionsProvider>
    </WidgetMetaContext.Provider>
  );
}
