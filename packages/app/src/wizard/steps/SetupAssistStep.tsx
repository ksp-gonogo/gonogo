import { Stack } from "@ksp-gonogo/ui-kit";
import styled from "styled-components";
import { SitrepConnection } from "../../settings/SitrepConnection";

/**
 * Setup-assist step (design `2026-07-18-uplink-hub-wizard-design.md` §3 step
 * 1 / §2.1) — embeds the SAME host/data-source connection UI
 * `SettingsModal`'s Data Sources tab uses (`SitrepConnection`, lifted out for
 * exactly this reuse), so the operator connects to their running Gonogo mod
 * before the wizard checks what it reports. Proceeding to the Results step
 * does not require a connected status — that step already handles "no mod
 * talking yet" as a waiting state, not an error (design §7).
 */
export function SetupAssistStep() {
  return (
    <Stack gap="sm">
      <Intro>
        Connect to your running mod. The next step lists its Uplinks and which
        clients are loaded.
      </Intro>
      <SitrepConnection />
    </Stack>
  );
}

const Intro = styled.p`
  margin: 0;
  font-size: var(--font-size-sm);
  color: var(--color-text-dim);
  line-height: 1.5;
`;
