import type { TopicReading } from "@ksp-gonogo/sitrep-client";
import { Section, SectionTitle } from "@ksp-gonogo/ui-kit";
import type { CSSProperties } from "react";
import { ContributionRow } from "./ContributionRow";
import type { Contribution } from "./flow";
import {
  PANEL_SECTION_LANDSCAPE,
  SECTION_COUNT,
  SECTION_EMPTY,
} from "./styles";

/**
 * One titled group of the breakdown. With no `emptyText` an empty group is
 * not drawn at all; with one it is drawn and says so.
 */
export function ContributionSection({
  title,
  rows,
  emptyText,
  listStyle,
  landscape,
  currency,
}: Readonly<{
  title: string;
  rows: readonly Contribution[];
  emptyText?: string;
  listStyle: CSSProperties;
  landscape: boolean;
  currency: TopicReading<unknown>;
}>) {
  if (rows.length === 0 && emptyText === undefined) return null;
  return (
    <Section
      as="section"
      style={landscape ? PANEL_SECTION_LANDSCAPE : undefined}
    >
      <SectionTitle as="h3">
        {title}
        {rows.length > 0 && <span style={SECTION_COUNT}>· {rows.length}</span>}
      </SectionTitle>
      {rows.length === 0 ? (
        <div style={SECTION_EMPTY}>{emptyText}</div>
      ) : (
        <ul style={listStyle}>
          {rows.map((c) => (
            <ContributionRow
              key={c.flightId}
              contribution={c}
              currency={currency}
            />
          ))}
        </ul>
      )}
    </Section>
  );
}
