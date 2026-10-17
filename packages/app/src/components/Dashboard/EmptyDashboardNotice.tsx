import { useScreen } from "@ksp-gonogo/core";
import { Button, EmptyState, Stack, Switch } from "@ksp-gonogo/ui-kit";
import styled from "styled-components";
import { useAnalyticsConsent } from "../../analytics/useAnalyticsConsent";
import { useOpenComponentPicker } from "../ComponentOverlay";

/**
 * What a dashboard with no widgets shows, with a button that opens the same
 * picker as the Add component button in the corner. Outside a screen that
 * mounts the picker there is nothing for it to open, so it shows no button.
 * On a screen that owns its analytics setting it also offers a quiet switch for
 * sending anonymous analytics, off until the operator turns it on; it is the
 * same setting as Settings, General, "Send technical analytics".
 */
export function EmptyDashboardNotice() {
  const openPicker = useOpenComponentPicker();
  const screen = useScreen();
  const [analytics, setAnalytics] = useAnalyticsConsent();
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
          {screen !== "station" && (
            <Switch
              checked={analytics}
              onChange={setAnalytics}
              label="Send anonymous analytics?"
            />
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
