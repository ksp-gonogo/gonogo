import styled from "styled-components";
import {
  type DisplayState,
  dsBorder,
  graphCardBg,
  graphCardOpacity,
} from "./graph-layout";

function nodeOpacity(display: DisplayState, unaffordable?: boolean): number {
  if (display === "locked") return 0.65;
  if (unaffordable) return 0.7;
  return 1;
}

function badgeToneColor(tone: "go" | "accent" | "muted"): string {
  if (tone === "go") return "var(--color-go-text)";
  if (tone === "accent") return "var(--color-accent-fg)";
  return "var(--color-text-faint)";
}

export const Controls = styled.div`
  display: flex;
  flex-direction: column;
  gap: var(--gap-related);
  /* No horizontal inset: Panel.Body already aligns the pills with the title. */
  padding-bottom: var(--gap-related-compact);
  flex-shrink: 0;
`;

export const FilterBar = styled.div`
  display: inline-flex;
  gap: var(--gap-related);
  flex-wrap: wrap;
`;

export const FilterBtn = styled.button<{ $active: boolean }>`
  font-size: var(--font-size-compact);
  letter-spacing: 0.06em;
  padding: var(--inset-control);
  border-radius: var(--radius-pill);
  border: 1px solid
    ${(p) => (p.$active ? "var(--color-accent-fg)" : "var(--color-border-subtle)")};
  background: ${(p) => (p.$active ? "var(--color-go-status)" : "transparent")};
  color: ${(p) =>
    p.$active ? "var(--color-go-text)" : "var(--color-text-muted)"};
  cursor: pointer;
  font-family: inherit;

  &:hover {
    color: var(--color-text-primary);
  }

  &:focus-visible {
    outline: 2px solid var(--color-accent-fg);
    outline-offset: 2px;
  }
`;

export const SearchInput = styled.input`
  background: var(--color-surface-sunken);
  border: 1px solid var(--color-border-strong);
  color: var(--color-text-primary);
  font: inherit;
  padding: var(--inset-control);
  border-radius: var(--radius-regular);
  outline: none;

  &:focus {
    border-color: var(--color-accent-fg);
  }

  &:focus-visible {
    outline: 2px solid var(--color-accent-fg);
    outline-offset: 2px;
  }
`;

export const NodeList = styled.ul`
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--gap-related);
`;

export const NodeRowWrap = styled.li<{
  $display: DisplayState;
  $unaffordable?: boolean;
}>`
  display: flex;
  flex-direction: column;
  background: var(--color-surface-panel);
  border-left: 2px solid
    ${(p) => (p.$unaffordable ? "var(--color-text-faint)" : dsBorder(p.$display))};
  border-radius: var(--radius-regular);
  opacity: ${(p) => nodeOpacity(p.$display, p.$unaffordable)};
`;

export const NodeHeader = styled.button`
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  align-items: center;
  gap: var(--gap-related);
  /* A record rather than a control, so --inset-surface: it has no --control-height floor. */
  padding: var(--inset-surface);
  background: transparent;
  border: none;
  cursor: pointer;
  font-family: inherit;
  text-align: left;

  &:hover {
    background: var(--color-surface-raised);
  }

  &:focus-visible {
    outline: 2px solid var(--color-accent-fg);
    outline-offset: -2px;
  }
`;

export const NodeTitle = styled.span`
  font-size: var(--font-size-value);
  color: var(--color-text-primary);
  font-weight: 600;
  display: flex;
  align-items: baseline;
  gap: var(--gap-related);
  flex: 1 1 8rem;
  min-width: 0;
  overflow: hidden;
`;

// `min-width: 0` lets the title ellipsise inside NodeTitle instead of colliding with the id, and the basis holds its width until the id gives way.
export const NodeTitleText = styled.span`
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

// Gives way before the title does: the name is what a row is read by.
export const NodeId = styled.span`
  font-size: var(--font-size-caption);
  font-family: var(--font-family-mono);
  color: var(--color-text-faint);
  font-weight: 400;
  flex: 0 1000 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

export const NodeMeta = styled.span`
  display: inline-flex;
  gap: var(--gap-related);
  align-items: center;
  flex-shrink: 0;
`;

export const Cost = styled.span<{ $insufficient?: boolean }>`
  font-size: var(--font-size-compact);
  color: ${(p) =>
    p.$insufficient ? "var(--color-nogo-text)" : "var(--color-accent-fg)"};
  font-variant-numeric: tabular-nums;
`;

export const StateBadge = styled.span<{ $tone: "go" | "accent" | "muted" }>`
  font-size: var(--font-size-caption);
  letter-spacing: 0.08em;
  text-transform: uppercase;
  padding: var(--inset-chip);
  border-radius: var(--radius-regular);
  color: ${(p) => badgeToneColor(p.$tone)};
  background: ${(p) =>
    p.$tone === "go" ? "var(--color-go-status)" : "transparent"};
`;

// Description, requires list, parts list and unlock control are different kinds of block, so the seam is --gap-section.
export const NodeBody = styled.div`
  display: flex;
  flex-direction: column;
  gap: var(--gap-section);
  padding: var(--inset-node-body);
  border-top: 1px dashed var(--color-border-subtle);
`;

export const Description = styled.div`
  font-size: var(--font-size-compact);
  color: var(--color-text-muted);
  line-height: var(--line-height-body);
  font-style: italic;
`;

export const Parents = styled.div`
  display: flex;
  align-items: baseline;
  gap: var(--gap-related);
  flex-wrap: wrap;
`;

export const ParentsLabel = styled.span`
  font-size: var(--font-size-caption);
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--color-text-faint);
`;

export const ParentsList = styled.span`
  display: inline-flex;
  gap: var(--gap-related);
  flex-wrap: wrap;
`;

export const ParentChip = styled.span`
  font-size: var(--font-size-caption);
  font-family: var(--font-family-mono);
  color: var(--color-text-muted);
  padding: var(--inset-chip);
  background: var(--color-surface-sunken);
  border-radius: var(--radius-regular);
`;

export const Parts = styled.div`
  display: flex;
  flex-direction: column;
  gap: var(--gap-related);
`;

export const PartsLabel = styled.span`
  font-size: var(--font-size-caption);
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--color-text-faint);
`;

export const PartsList = styled.ul`
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--gap-line);
`;

export const PartRow = styled.li<{ $purchased: boolean }>`
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: var(--gap-related);
  font-size: var(--font-size-compact);
  padding: var(--inset-part-row);
  opacity: ${(p) => (p.$purchased ? 0.7 : 1)};
`;

export const PartTitle = styled.span`
  color: var(--color-text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
  min-width: 0;
`;

export const PartMeta = styled.span`
  display: inline-flex;
  gap: var(--gap-related);
  align-items: baseline;
  flex-shrink: 0;
`;

export const PartCategory = styled.span`
  font-size: var(--font-size-caption);
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--color-text-faint);
`;

export const PartCost = styled.span`
  font-size: var(--font-size-compact);
  color: var(--color-accent-fg);
  font-variant-numeric: tabular-nums;
`;

export const PartPurchased = styled.span`
  font-size: var(--font-size-compact);
  color: var(--color-go-text);
`;

export const UnlockRow = styled.div`
  display: flex;
  justify-content: flex-end;
`;

export const Empty = styled.div`
  color: var(--color-text-faint);
  font-size: var(--font-size-compact);
  padding: var(--inset-tile-message);
  text-align: center;
`;

export const SciReadout = styled.span`
  color: var(--color-accent-fg);
  font-variant-numeric: tabular-nums;
  margin-left: var(--gap-lead-figure);
`;

export const TechMeta = styled.div`
  color: var(--color-text-muted);
  font-size: var(--font-size-compact);
  margin-bottom: var(--gap-related-compact);
`;

export const GraphToolbar = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--gap-section);
  flex-shrink: 0;
  flex-wrap: wrap;
`;

// --gap-section between legend entries and --gap-related inside one, or the swatches and words run together.
export const Legend = styled.div`
  display: inline-flex;
  gap: var(--gap-section);
`;

export const LegendItem = styled.span`
  display: inline-flex;
  align-items: center;
  gap: var(--gap-related);
  font-size: var(--font-size-caption);
  color: var(--color-text-muted);
  letter-spacing: 0.04em;
`;

export const Swatch = styled.span<{ $kind: DisplayState }>`
  width: 10px;
  height: 10px;
  border-radius: var(--radius-regular);
  border: 2px solid ${(p) => dsBorder(p.$kind)};
  background: ${(p) =>
    p.$kind === "owned"
      ? "var(--color-go-mark)"
      : "var(--color-surface-sunken)"};
`;

export const GraphScroll = styled.div`
  flex: 1;
  min-height: 0;
  overflow: auto;
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-regular);
  background: var(--color-surface-sunken);
  scrollbar-width: thin;
`;

export const GraphCanvas = styled.div`
  position: relative;
`;

export const EdgeLayer = styled.svg`
  position: absolute;
  inset: 0;
  pointer-events: none;
`;

export const GraphCard = styled.button<{
  $ds: DisplayState;
  $selected: boolean;
  $dimmed: boolean;
}>`
  position: absolute;
  display: flex;
  flex-direction: column;
  justify-content: flex-start;
  gap: var(--gap-line);
  /* Sized against CARD_H: a taller inset clips the two-line title. */
  padding: var(--inset-graph-card);
  overflow: hidden;
  text-align: left;
  font-family: inherit;
  cursor: pointer;
  border-radius: var(--radius-regular);
  border: 1px solid ${(p) => dsBorder(p.$ds)};
  border-left-width: 3px;
  background: ${(p) => graphCardBg(p.$ds)};
  opacity: ${(p) => graphCardOpacity(p.$ds, p.$dimmed)};
  box-shadow: ${(p) =>
    p.$selected ? "0 0 0 2px var(--color-accent-fg)" : "none"};
  transition: opacity var(--duration-fast) var(--ease-standard);

  &:hover {
    filter: brightness(1.12);
  }

  &:focus-visible {
    outline: 2px solid var(--color-accent-fg);
    outline-offset: 2px;
  }
`;

// Off both type scales: the fixed CARD_H of 48 leaves a 37px content budget that the title already fills; changing these means raising CARD_H.
export const GraphCardTitle = styled.span`
  font-size: 11px;
  font-weight: 600;
  color: var(--color-text-primary);
  line-height: 1.15;
  overflow: hidden;
  text-overflow: ellipsis;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
`;

export const GraphCardMeta = styled.span`
  display: inline-flex;
  align-items: baseline;
`;

export const GraphCost = styled.span<{ $ds: DisplayState }>`
  /* Off the type scale: the same CARD_H budget as GraphCardTitle. */
  font-size: 10px;
  font-variant-numeric: tabular-nums;
  color: ${(p) =>
    p.$ds === "researchable"
      ? "var(--color-accent-fg)"
      : "var(--color-text-muted)"};
`;

export const GraphOwned = styled.span`
  /* Off the type scale: the same CARD_H budget as GraphCardTitle. */
  font-size: 10px;
  color: var(--color-go-text);
  letter-spacing: 0.04em;
`;

// Different kinds of block in a bordered box, so --gap-section and --inset-surface.
export const Detail = styled.div`
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  gap: var(--gap-section);
  padding: var(--inset-surface);
  margin-top: var(--gap-related-compact);
  background: var(--color-surface-panel);
  border: 1px solid var(--color-border-strong);
  border-radius: var(--radius-regular);
  max-height: 40%;
  overflow: auto;
`;

export const DetailHead = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: var(--gap-related);
`;

export const DetailTitle = styled.span`
  font-size: var(--font-size-value);
  font-weight: 600;
  color: var(--color-text-primary);
  display: inline-flex;
  align-items: baseline;
  gap: var(--gap-related);
`;

export const CloseBtn = styled.button`
  background: transparent;
  border: none;
  color: var(--color-text-muted);
  cursor: pointer;
  font-size: var(--font-size-base);
  line-height: var(--line-height-flush);
  padding: var(--inset-control);
  border-radius: var(--radius-regular);
  font-family: inherit;

  &:hover {
    color: var(--color-text-primary);
  }

  &:focus-visible {
    outline: 2px solid var(--color-accent-fg);
    outline-offset: 2px;
  }
`;

export const DetailMeta = styled.div`
  display: flex;
  align-items: baseline;
  gap: var(--gap-section);
  flex-wrap: wrap;
  font-size: var(--font-size-compact);
  color: var(--color-text-muted);
`;

export const ParentsInline = styled.span`
  display: inline-flex;
  align-items: baseline;
  gap: var(--gap-related);
  flex-wrap: wrap;
  font-size: var(--font-size-compact);
  letter-spacing: 0.04em;
`;
