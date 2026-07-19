import { Stack } from "@ksp-gonogo/ui-kit";
import styled from "styled-components";

/**
 * Welcome step (design §1 step 1 — "first-run only"). Task C scoped its
 * two-step build to setup-assist + results only; this bookend step is added
 * by the first-run auto-open host, never by the persistent Settings-tab
 * entry point (see `UplinkHubWizard`'s `firstRun` prop).
 */
export function WelcomeStep() {
  return (
    <Stack gap="sm">
      <Copy>
        Load Uplink clients like SCANsat, kOS, and Kerbcast from the Hub as your
        mod reports them installed.
      </Copy>
      <Copy>
        This checks your mod connection and lists what's ready to load. Reopen
        it any time from the Uplink Hub tab in Settings.
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
