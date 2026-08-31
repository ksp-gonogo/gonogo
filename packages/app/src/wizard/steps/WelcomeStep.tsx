import { Stack } from "@ksp-gonogo/ui-kit";
import styled from "styled-components";

/**
 * Shown only on a first run, by the auto-opening host. The persistent
 * Settings-tab entry point never renders it, which is what `UplinkHubWizard`'s
 * `firstRun` prop decides.
 *
 * The copy names no Uplink on purpose. Listing a few of them dates the moment
 * it is written, reads as an endorsement of those over the rest, and says
 * nothing an operator who has not met the word "Uplink" needs; what they need
 * is what an Uplink IS.
 */
export function WelcomeStep() {
  return (
    <Stack gap="sm">
      <Copy>
        An Uplink adds the widgets and telemetry for one mod. Load them from the
        Hub as your mod reports them installed.
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
  line-height: var(--line-height-prose);
`;
