import { faintText, TONE_TEXT } from "@ksp-gonogo/ui-kit";
// biome-ignore lint/style/noRestrictedImports: the graph card is a positioned node with state-keyed colours and a type size fixed by the card height, which no kit primitive expresses
import styled from "styled-components";
import {
  type DisplayState,
  graphCardBg,
  graphCardBorder,
} from "./graph-layout";

export const GraphScroll = styled.div`
  flex: 1;
  min-height: 0;
  min-width: 0;
  overflow: auto;
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
  border: 1px solid ${(p) => graphCardBorder(p.$ds, p.$dimmed)};
  border-left-width: 3px;
  background: ${(p) => graphCardBg(p.$ds, p.$dimmed)};
  ${(p) => (p.$ds === "locked" || p.$dimmed ? faintText() : "")}
  box-shadow: ${(p) =>
    p.$selected ? "0 0 0 2px var(--color-accent-fg)" : "none"};
  transition:
    background var(--duration-fast) var(--ease-standard),
    border-color var(--duration-fast) var(--ease-standard);

  &:hover {
    filter: brightness(1.12);
  }

  &:focus-visible {
    outline: 2px solid var(--color-focus);
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

export const GraphCost = styled.span<{ $ds: DisplayState; $dimmed: boolean }>`
  /* Off the type scale: the same CARD_H budget as GraphCardTitle. */
  font-size: 10px;
  font-variant-numeric: tabular-nums;
  color: ${(p) =>
    p.$ds === "researchable" && !p.$dimmed
      ? TONE_TEXT.info
      : "var(--color-text-muted)"};
`;

export const GraphOwned = styled.span<{ $dimmed: boolean }>`
  /* Off the type scale: the same CARD_H budget as GraphCardTitle. */
  font-size: 10px;
  color: ${(p) =>
    p.$dimmed ? "var(--color-text-faint)" : "var(--color-go-text)"};
  letter-spacing: 0.04em;
`;
