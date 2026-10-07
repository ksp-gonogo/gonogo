import { EmptyState, Stack } from "@ksp-gonogo/ui-kit";
import styled from "styled-components";

/**
 * What a dashboard with no widgets shows. The control it names is the Add
 * component floating button, which is a real button reachable by keyboard, so
 * the notice only points at it.
 */
export function EmptyDashboardNotice() {
  return (
    <EmptyDashboardNotice__Frame>
      <EmptyState layout="fill">
        <Stack>
          <span>No widgets on this dashboard</span>
          <span>
            Use the + button at the bottom right (Add component) to add one
          </span>
        </Stack>
      </EmptyState>
    </EmptyDashboardNotice__Frame>
  );
}

const EmptyDashboardNotice__Frame = styled.div`
  display: flex;
  height: 60vh;
`;
