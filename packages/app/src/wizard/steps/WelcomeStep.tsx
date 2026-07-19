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
        Gonogo can load extra Uplink clients like SCANsat, kOS, and Kerbcast,
        plus more as they're published, straight from the Hub the moment your
        mod reports them installed.
      </Copy>
      <Copy>
        This quick setup checks your connection to the mod, then shows what's
        ready to load. You can revisit it any time from Settings → Uplink Hub.
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
