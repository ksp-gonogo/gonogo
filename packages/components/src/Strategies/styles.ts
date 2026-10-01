import { Badge, Block, Row } from "@ksp-gonogo/ui-kit";
// biome-ignore lint/style/noRestrictedImports: type and card treatments not yet expressed in kit primitives
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
      $active ? "var(--color-go-mark)" : "var(--color-border-subtle)"};
  border-radius: var(--radius-regular);
  /* Deliberately very dark: the dim body text has almost no contrast headroom, so the border carries the green. */
  background: ${({ $active }) =>
    $active ? "var(--color-go-muted)" : "transparent"};
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

/**
 * One line of the game's own effect prose, relayed verbatim rather than judged
 * (see `CostChip` below for the other half of that distinction). Built on
 * `Row`, ui-kit's list-row primitive, for the padded, gapped `<li>` shape;
 * left unwrapped in `RowName` since that truncates, and this text wraps.
 */
export const EffectLine = styled(Row)`
  justify-content: flex-start;
  align-items: flex-start;
  color: var(--color-text-primary);
  line-height: var(--line-height-body);
  &::before {
    content: "·";
    color: var(--color-text-dim);
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

/**
 * Our own verdict about a record (what a currency costs, whether the career
 * can currently cover it), not the game's words, unlike `EffectLine` above.
 * Built on `Badge` for its tone vocabulary and pill; the caps/weight/tracking
 * a status word carries is dropped, since a chip here holds a formatted
 * amount rather than a one-word state.
 */
export const CostChip = styled(Badge)`
  text-transform: none;
  font-weight: 400;
  letter-spacing: normal;
  font-variant-numeric: tabular-nums;
  border-radius: var(--radius-pill);
`;

export const FactorRow = styled.div`
  display: flex;
  align-items: center;
  gap: var(--gap-related);
  margin-top: var(--gap-actions);
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
    p.$overCap ? "var(--color-warn-mark)" : "var(--color-text-primary)"};
  font-variant-numeric: tabular-nums;
  font-weight: ${(p) => (p.$overCap ? 700 : 400)};
`;

export const Sep = styled.span`
  color: var(--color-text-dim);
`;
