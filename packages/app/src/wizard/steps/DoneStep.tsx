import { Stack } from "@ksp-gonogo/ui-kit";
import styled from "styled-components";

/**
 * Done step (design §1 step 7). Bookends the first-run flow — see
 * `WelcomeStep`'s doc comment for why this only appears when
 * `UplinkHubWizard` is opened with `firstRun`.
 */
export function DoneStep() {
  return (
    <Stack gap="sm">
      <Copy>
        You're set up. Any Uplink the mod reports that isn't loaded yet keeps
        showing here. Reopen this any time from the Uplink Hub tab in Settings.
      </Copy>
    </Stack>
  );
}

const Copy = styled.p`
  margin: 0;
  font-size: var(--font-size-sm);
  color: var(--color-text-dim);
  line-height: 1.5;
`;
