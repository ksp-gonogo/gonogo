import { ScrollArea } from "@ksp-gonogo/ui-kit";
import styled from "styled-components";

/** Collapses when there is no encounter or apsis data. */
export const OrbitalEventChipsRow = styled.div`
  display: flex;
  &:empty {
    display: none;
  }
`;

export const CurrentSummary = styled.div`
  margin-top: var(--gap-related-compact);
  display: flex;
  flex-direction: column;
  gap: var(--gap-related);
`;

export const CurrentSummaryTop = styled.div`
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--gap-related);
`;

export const CurrentSummaryName = styled.span`
  font-size: var(--font-size-value);
  font-weight: 600;
  color: var(--color-go-text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
`;

export const CurrentSummaryDistance = styled.span`
  font-size: var(--font-size-compact);
  color: var(--color-accent-fg);
  font-variant-numeric: tabular-nums;
  flex-shrink: 0;
`;

export const CurrentSummaryMeta = styled.div`
  display: flex;
  align-items: center;
  gap: var(--gap-headline);
  font-size: var(--font-size-caption);
  color: var(--color-text-muted);
  letter-spacing: 0.04em;
`;

export const FilterInput = styled.input`
  margin-top: var(--gap-related-compact);
  font-size: var(--font-size-value);
  padding: var(--inset-control);
  background: var(--color-surface-app);
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-regular);
  color: var(--color-text-primary);
  &:focus-visible {
    outline: 2px solid var(--color-accent-fg);
    outline-offset: 2px;
  }
`;

export const ListScroll = styled(ScrollArea)`
  flex: 1;
  margin-top: var(--gap-related-compact);
  [data-scroll-area-inner] {
    display: flex;
    flex-direction: column;
    gap: var(--gap-related);
  }
`;

export const SuggestedHeading = styled.div`
  font-size: var(--font-size-caption);
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--color-text-muted);
  /* Shared with SectionToggle, so the heading and the toggle start on one left edge. */
  padding: var(--inset-list-heading);
`;

export const SectionHeaderRow = styled.div`
  display: flex;
  align-items: center;
  gap: var(--gap-related);
`;

export const SectionToggle = styled.button`
  display: flex;
  align-items: center;
  gap: var(--gap-related);
  flex: 1;
  min-width: 0;
  background: none;
  border: none;
  /* Shared with SuggestedHeading. */
  padding: var(--inset-list-heading);
  font-size: var(--font-size-compact);
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--color-text-muted);
  cursor: pointer;
  font-family: inherit;
  text-align: left;
  &:hover {
    color: var(--color-text-primary);
  }
  &:focus-visible {
    outline: 2px solid var(--color-accent-fg);
    outline-offset: 2px;
  }
`;

export const SectionChevron = styled.span<{ $expanded: boolean }>`
  display: inline-block;
  transition: transform var(--duration-fast) var(--ease-standard);
  transform: rotate(${({ $expanded }) => ($expanded ? "90deg" : "0deg")});
  flex-shrink: 0;
`;

export const SectionBody = styled.div`
  display: flex;
  flex-direction: column;
  gap: var(--gap-line);
`;

export const RowMain = styled.span`
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
`;

export const EntryName = styled.span`
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

export const RowSubtitle = styled.span`
  font-size: var(--font-size-caption);
  color: currentColor;
  opacity: 0.7;
  letter-spacing: 0.05em;
  text-transform: uppercase;
`;

export const RowDistance = styled.span`
  font-size: var(--font-size-compact);
  color: var(--color-text-muted);
  font-variant-numeric: tabular-nums;
  margin-right: var(--gap-trailing-mark);
  flex-shrink: 0;
`;

export const RowTag = styled.span`
  font-size: var(--font-size-compact);
  font-weight: 700;
  letter-spacing: 0.12em;
  color: var(--color-go-text);
`;

export const SpaceObjectToggle = styled.button`
  margin-left: auto;
  font-size: var(--font-size-compact);
  padding: var(--inset-control-small);
  border-radius: var(--radius-pill);
  border: 1px solid var(--color-border-subtle);
  background: transparent;
  color: var(--color-text-muted);
  cursor: pointer;
  letter-spacing: 0.04em;
  font-family: inherit;
  &[aria-pressed="true"] {
    color: var(--color-info-text);
    border-color: var(--color-info-mark);
  }
  &:hover {
    filter: brightness(1.15);
  }
  &:focus-visible {
    outline: 2px solid var(--color-accent-fg);
    outline-offset: 2px;
  }
`;

export const Hint = styled.div`
  margin-top: var(--gap-related-compact);
  font-size: var(--font-size-compact);
  color: var(--color-text-faint);
  line-height: var(--line-height-body);
`;

export const CompactCurrent = styled.div`
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--gap-related);
  text-align: center;
`;

export const CompactName = styled.div`
  font-size: var(--font-size-value);
  font-weight: 700;
  color: var(--color-text-primary);
  letter-spacing: 0.04em;
`;

export const CompactDistance = styled.div`
  font-size: var(--font-size-compact);
  color: var(--color-accent-fg);
  letter-spacing: 0.04em;
`;
