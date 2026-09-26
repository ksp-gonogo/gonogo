import { Select } from "@ksp-gonogo/ui-kit";
import styled from "styled-components";

// Body inline-size at which the chart moves from under the list to beside it.
export const WIDE_AT = "560px";

// Below this body width the destination select takes its own line: at 5 and 6 units wide "WINDOWS TO" plus a select does not fit.
export const NARROW_HEAD_AT = "256px";
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
