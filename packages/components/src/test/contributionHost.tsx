import { ContributionsProvider } from "@ksp-gonogo/core";
import {
  WidgetMetaContext,
  type WidgetMetaContextValue,
} from "@ksp-gonogo/ui-kit";
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
  contributionSlots: readonly string[];
}) {
  const meta = {
    componentId,
    contributionSlots,
  } as unknown as WidgetMetaContextValue;
  return (
    <WidgetMetaContext.Provider value={meta}>
      <ContributionsProvider>{children}</ContributionsProvider>
    </WidgetMetaContext.Provider>
  );
}
