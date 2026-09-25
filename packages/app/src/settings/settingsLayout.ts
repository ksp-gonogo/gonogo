import { Cluster, Input } from "@ksp-gonogo/ui-kit";
import styled from "styled-components";

export const SectionStack = styled.div`
  display: flex;
  flex-direction: column;
  gap: var(--gap-section);
  overflow-y: auto;
  min-height: 0;
`;

// align="start" is what unblocked this one: the row's label must sit at the
// TOP when its control wraps to two lines, and Cluster only centred. The
// indent for a dependent setting is genuinely this modal's.
export const SettingLine = styled(Cluster).attrs({
  align: "start" as const,
  gap: "xl" as const,
})<{ $indented?: boolean }>`
  /* Interpolated, so no CSS token pass reaches it. Migrated by hand onto the
     same 20 -> 16 snap the Empty padding below takes, otherwise this
     dependent-setting indent is the one 20px left in the file. */
  margin-left: ${({ $indented }) => ($indented ? "var(--space-16)" : "0")};
`;

/* A read-only row owns its own label/value pairing (a `<dl>`), so it takes the
   line's indent and width and nothing else of the switch-row furniture. */
export const SettingReadOnlyLine = styled.div<{ $indented?: boolean }>`
  margin-left: ${({ $indented }) => ($indented ? "var(--space-16)" : "0")};
`;
/* A named group inside a category: an h4 under the category's h3, so the
   heading order a screen reader walks matches the nesting it is shown. */
export const GroupTitle = styled.h4`
  margin: 0;
  font-size: var(--font-size-value);
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--color-text-dim);
`;
export const SettingInput = styled(Input)`
  width: 10em;
  text-align: right;
  font-variant-numeric: tabular-nums;
`;
export const RowText = styled.div`
  display: flex;
  flex-direction: column;
  gap: var(--gap-related);
  min-width: 0;
`;

export const RowLabel = styled.span`
  color: var(--color-text-primary);
  font-size: var(--font-size-value);
`;

export const RowDesc = styled.span`
  color: var(--color-text-dim);
  font-size: var(--font-size-compact);
  max-width: 32em;
`;

export const Empty = styled.div`
  color: var(--color-text-faint);
  font-size: var(--font-size-compact);
  padding: var(--space-16);
  text-align: center;
`;
