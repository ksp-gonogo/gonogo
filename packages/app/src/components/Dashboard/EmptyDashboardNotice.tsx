import { Button, EmptyState, Stack } from "@ksp-gonogo/ui-kit";
import styled from "styled-components";
import { useOpenComponentPicker } from "../ComponentOverlay";

/**
 * What a dashboard with no widgets shows, with a button that opens the same
 * picker as the Add component button in the corner. Outside a screen that
 * mounts the picker there is nothing for it to open, so it shows no button.
 */
export function EmptyDashboardNotice() {
  const openPicker = useOpenComponentPicker();
  return (
    <EmptyDashboardNotice__Frame>
      <EmptyState layout="fill">
        <Stack>
          <span>No widgets on this dashboard</span>
          {openPicker && (
            <Button variant="primary" type="button" onClick={openPicker}>
              Add a widget
            </Button>
          )}
        </Stack>
      </EmptyState>
    </EmptyDashboardNotice__Frame>
  );
}

const EmptyDashboardNotice__Frame = styled.div`
  display: flex;
  height: 60vh;
`;
