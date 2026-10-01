import { Select } from "@ksp-gonogo/ui-kit";
// biome-ignore lint/style/noRestrictedImports: type and layout treatments not yet expressed in kit primitives
import styled from "styled-components";

// Body inline-size at which the chart moves from under the list to beside it.
const WIDE_AT = "560px";

// Below this body width the destination select takes its own line: at 5 and 6 units wide "WINDOWS TO" plus a select does not fit.
const NARROW_HEAD_AT = "256px";
// The query container, so the content grid reflows on the body's own width (a container cannot query itself).
export const Body = styled.div`
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: var(--gap-related);
  container-type: inline-size;
`;

export const ContentGrid = styled.div`
  flex: 1;
  min-height: 100%;
  display: flex;
  flex-direction: column;
  gap: var(--gap-section);

  @container (min-width: ${WIDE_AT}) {
    flex-direction: row;
    align-items: stretch;
  }
`;

export const LeftCol = styled.div`
  display: flex;
  flex-direction: column;
  gap: var(--gap-section);
  min-width: 0;

  @container (min-width: ${WIDE_AT}) {
    flex: 0 1 340px;
  }
`;

export const RouteSelect = styled(Select)`
  width: auto;
  /* Shrinkable, so the heading fits a narrow panel; it cannot go below its own content. */
  min-width: 0;
  max-width: 100%;

  /* Too narrow to share a line with the label, so the select takes its own. */
  @container (max-width: ${NARROW_HEAD_AT}) {
    flex: 1 1 100%;
  }
`;

export const NowRow = styled.div`
  display: flex;
  gap: var(--gap-section);
  align-items: center;
`;

// Grows to fill the tile down to a minimum height; the SVG scales to fit undistorted.
export const MapBox = styled.div`
  flex: 1 1 auto;
  min-height: 220px;
  min-width: 0;

  @container (min-width: ${WIDE_AT}) {
    min-height: 0;
  }
`;

export const MapSvg = styled.svg`
  width: 100%;
  height: 100%;
  display: block;
`;

export const PhaseDialSvg = styled.svg`
  width: 96px;
  height: 96px;
  flex-shrink: 0;
`;

export const NowFacts = styled.div`
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--gap-related);
  min-width: 0;
`;

export const NowLabel = styled.span`
  color: var(--color-text-muted);
  font-size: var(--font-size-caption);
  text-transform: uppercase;
  letter-spacing: 0.08em;
`;

export const NowValue = styled.span`
  color: var(--color-text-primary);
  font-size: var(--font-size-figure);
  font-variant-numeric: tabular-nums;
`;

export const Muted = styled.span`
  color: var(--color-text-dim);
  font-size: var(--font-size-compact);
`;

export const ListWrap = styled.div`
  display: flex;
  flex-direction: column;
  gap: var(--gap-related);
`;

export const ListTitle = styled.div`
  color: var(--color-text-muted);
  font-size: var(--font-size-caption);
  text-transform: uppercase;
  letter-spacing: 0.08em;
`;

export const SectionHead = styled.div`
  display: flex;
  align-items: center;
  gap: var(--gap-related);
  /* The heading and its select are one phrase, so they wrap together. */
  flex-wrap: wrap;
  min-width: 0;
`;

export const ReachHead = styled.div`
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--gap-related);
  flex-wrap: wrap;
`;

export const BudgetReadout = styled.span`
  display: inline-flex;
  align-items: baseline;
  gap: var(--gap-related);
  font-size: var(--font-size-compact);
  font-variant-numeric: tabular-nums;
`;

// Scrolls rather than clipping at narrow placements, so no column is lost silently; `min-width` keeps columns from collapsing.
export const ReachScroll = styled.div`
  overflow-x: auto;
  max-width: 100%;
`;

export const ReachTable = styled.table`
  width: 100%;
  border-collapse: collapse;
  font-size: var(--font-size-compact);
`;

export const ReachTh = styled.th`
  text-align: left;
  /* Shared with ReachTd below, which has to match it. */
  padding: var(--inset-reach-cell);
  color: var(--color-text-muted);
  font-weight: normal;
  font-size: var(--font-size-caption);
  text-transform: uppercase;
  letter-spacing: 0.06em;
  border-bottom: 1px solid var(--color-border-subtle);

  &:not(:first-child) {
    text-align: right;
  }
`;

export const ReachTd = styled.td`
  /* Matches ReachTh above. */
  padding: var(--inset-reach-cell);
  border-bottom: 1px solid var(--color-border-subtle);
  white-space: nowrap;
`;

export const ReachTdNum = styled(ReachTd)`
  text-align: right;
  font-variant-numeric: tabular-nums;
`;

export const ReachFooter = styled.div`
  color: var(--color-text-dim);
  font-size: var(--font-size-compact);
`;

export const List = styled.ul`
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--gap-related);
`;

export const ListItem = styled.li`
  display: flex;
  flex-direction: column;
`;

export const ColWait = styled.span`
  font-size: var(--font-size-compact);
  font-variant-numeric: tabular-nums;
  color: var(--color-text-primary);
`;

export const ColDv = styled.span`
  font-size: var(--font-size-compact);
  font-variant-numeric: tabular-nums;
  color: var(--color-text-muted);
`;

export const ColTof = styled.span`
  font-size: var(--font-size-compact);
  font-variant-numeric: tabular-nums;
  color: var(--color-text-dim);
`;

export const Expander = styled.div`
  display: flex;
  flex-direction: column;
  gap: var(--gap-related);
  padding: var(--inset-window-expander);
`;

export const ExpRow = styled.div`
  display: flex;
  justify-content: space-between;
  gap: var(--gap-section);
`;

export const ExpLabel = styled.span`
  color: var(--color-text-muted);
  font-size: var(--font-size-compact);
`;

export const ExpValue = styled.span`
  color: var(--color-text-primary);
  font-size: var(--font-size-value);
  font-variant-numeric: tabular-nums;
`;

export const PorkchopWrap = styled.div`
  display: flex;
  flex-direction: column;
  gap: var(--gap-related);
  min-width: 0;
  flex: 1 1 auto;
  min-height: 260px;

  @container (min-width: ${WIDE_AT}) {
    min-height: 0;
  }
`;

export const PorkchopTitle = styled.div`
  color: var(--color-text-muted);
  font-size: var(--font-size-value);
`;

export const Inspector = styled.div`
  font-size: var(--font-size-compact);
  color: var(--color-text-dim);
  font-variant-numeric: tabular-nums;
  min-height: 1.2em;
`;
