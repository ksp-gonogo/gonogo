import { Block } from "@ksp-gonogo/ui-kit";
import styled from "styled-components";

/** `Panel`'s own column template; `auto-fit` collapses empty tracks, which `minColWidth` (auto-fill) would not. */
export const SCREEN_COLUMNS = "repeat(auto-fit, minmax(min(13rem, 100%), 1fr))";

export const Empty = styled.p`
  margin: 0;
  color: var(--color-text-dim);
  font-style: italic;
  font-size: var(--font-size-compact);
`;

/** `Block` rather than `Card`: an active strategy is a green border and tint, and a card's own ground would sit between them. */
export const StrategyCard = styled(Block).attrs({
  // `forwardedAs`, not `as`, which would replace Block with a bare article.
  forwardedAs: "article" as const,
})<{ $active?: boolean }>`
  padding: var(--inset-surface);
  border: 1px solid
    ${({ $active }) =>
      $active ? "var(--color-status-go-mark)" : "var(--color-border-subtle)"};
  border-radius: var(--radius-regular);
  /* Deliberately very dark: the dim body text has almost no contrast headroom, so the border carries the green. */
  background: ${({ $active }) =>
    $active ? "var(--color-status-go-muted)" : "transparent"};
`;

export const CardDept = styled.span`
  color: var(--color-text-dim);
  font-size: var(--font-size-caption);
  letter-spacing: 0.06em;
  text-transform: uppercase;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
`;

export const EffectList = styled.ul`
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--gap-related);
`;

export const EffectLine = styled.li`
  color: var(--color-text-primary);
  font-size: var(--font-size-compact);
  line-height: var(--line-height-body);
  &::before {
    content: "·";
    color: var(--color-text-dim);
    margin-right: var(--gap-trailing-mark);
  }
`;

export const BlockedNote = styled.p`
  margin: 0;
  color: var(--color-text-dim);
  font-size: var(--font-size-compact);
  font-style: italic;
`;

/** The screen's one inset: no group inside pads itself, so the lists and an augment body line up. */
export const ScreenInset = styled.div`
  display: flex;
  flex-direction: column;
  gap: var(--gap-section);
  padding: var(--gutter-screen-body);
`;

/** The body of a locked screen; its tab stays selectable so the reason stays reachable. */
export const LockedScreen = styled.p`
  margin: 0;
  padding: var(--inset-empty-state);
  color: var(--color-text-dim);
  font-size: var(--font-size-compact);
  text-align: center;
`;

export const FactorTag = styled.span`
  font-size: var(--font-size-caption);
  color: var(--color-text-dim);
  letter-spacing: 0.04em;
`;

export const ExpandToggle = styled.button`
  background: none;
  border: none;
  padding: 0;
  text-align: left;
  cursor: pointer;
  color: inherit;
  &:focus-visible {
    outline: 2px solid var(--color-accent-fg);
    outline-offset: 2px;
  }
`;

export const Description = styled.p`
  margin: var(--gap-caption) 0 var(--gap-sub-readout);
  color: var(--color-text-dim);
  font-size: var(--font-size-compact);
  line-height: var(--line-height-body);
`;

export const CostRow = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: var(--gap-related);
  margin-top: var(--gap-caption);
`;

export const CostChip = styled.span<{ $insufficient?: boolean }>`
  font-size: var(--font-size-compact);
  padding: var(--inset-chip);
  border-radius: var(--radius-pill);
  background: ${({ $insufficient }) =>
    $insufficient
      ? "var(--color-status-alert-muted)"
      : "var(--color-surface-raised)"};
  color: ${({ $insufficient }) =>
    $insufficient
      ? "var(--color-status-nogo-fg)"
      : "var(--color-text-primary)"};
  font-variant-numeric: tabular-nums;
`;

export const FactorRow = styled.div`
  display: flex;
  align-items: center;
  gap: var(--gap-related);
  margin-top: var(--gap-actions);
`;

/** A range input styled per engine, since a bare one paints differently in each and does not shrink in a flex row. */
export const Slider = styled.input`
  flex: 1;
  min-width: 0;
  width: 100%;
  height: 16px;
  margin: 0;
  padding: 0;
  background: transparent;
  cursor: pointer;
  appearance: none;
  -webkit-appearance: none;

  /* Both tracks must stay identical or Chromium and Firefox diverge. */
  &::-webkit-slider-runnable-track {
    width: 100%;
    height: 4px;
    border-radius: var(--radius-pill);
    background: var(--color-border-strong);
  }

  &::-webkit-slider-thumb {
    -webkit-appearance: none;
    appearance: none;
    width: 14px;
    height: 14px;
    /* Off the spacing ladder: (track height - thumb size) / 2, which centres the thumb on the track. */
    margin-top: -5px;
    border-radius: var(--radius-circle);
    background: var(--color-accent-fg);
  }

  &::-moz-range-track {
    width: 100%;
    height: 4px;
    border-radius: var(--radius-pill);
    background: var(--color-border-strong);
  }

  &::-moz-range-thumb {
    width: 14px;
    height: 14px;
    border: none;
    border-radius: var(--radius-circle);
    background: var(--color-accent-fg);
  }

  &:focus-visible {
    outline: 2px solid var(--color-accent-fg);
    outline-offset: 2px;
  }

  &::-moz-focus-outer {
    border: 0;
  }
`;

export const FactorLabel = styled.span`
  font-size: var(--font-size-caption);
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--color-text-dim);
`;

export const FactorValue = styled.span`
  font-variant-numeric: tabular-nums;
  color: var(--color-text-primary);
  font-size: var(--font-size-value);
  min-width: 3em;
  text-align: right;
`;

export const BalanceRow = styled.div`
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: var(--gap-related);
  color: var(--color-text-dim);
  font-size: var(--font-size-compact);
`;

export const Tally = styled.span<{ $overCap?: boolean }>`
  color: ${(p) =>
    p.$overCap
      ? "var(--color-status-warning-bg)"
      : "var(--color-text-primary)"};
  font-variant-numeric: tabular-nums;
  font-weight: ${(p) => (p.$overCap ? 700 : 400)};
`;

export const Sep = styled.span`
  color: var(--color-text-dim);
`;

export const TinyFundsRow = styled.div`
  display: flex;
  gap: var(--gap-related);
  padding: var(--inset-tiny-row);
  font-size: var(--font-size-compact);
  color: var(--color-status-go-fg);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  overflow: hidden;
`;

/** The balance never gives up width: the tally beside it does. */
export const TinyFundsFigure = styled.span`
  flex: none;
`;

export const TinyTally = styled.span`
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
`;

export const TinyDrainRow = styled.div`
  padding: var(--inset-tiny-row);
  font-size: var(--font-size-compact);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`;
