import { CommandBlock } from "@ksp-gonogo/ui";
import { LiveRegion, Stack, Text } from "@ksp-gonogo/ui-kit";
import styled from "styled-components";
import {
  type CheckState,
  relayCheck,
  type SetupCheck,
  uplinksCheck,
} from "../checks";
import { CONTAINER_LOGS_COMMAND, SETUP_LINKS } from "../setupGuide";
import { useConnectionCheck } from "../useConnectionCheck";
import { useRelayHealth } from "../useRelayHealth";
import { useUplinkReadiness } from "../useUplinkReadiness";
import { CheckReading, DocLink, Hint } from "./StepParts";

const SETTLED_BAD: readonly CheckState[] = ["fail", "attention"];

function verdict(checks: readonly SetupCheck[]): string {
  if (checks.some((check) => check.state === "checking"))
    return "Checking your setup";
  const bad = checks.filter((check) => SETTLED_BAD.includes(check.state));
  if (bad.length === 0) return "Everything is working";
  return `${bad.length} of ${checks.length} checks ${bad.length === 1 ? "needs" : "need"} a look`;
}

/**
 * The three earlier checks again, side by side and still live, so an operator
 * who skipped ahead or fixed something in another window sees the whole setup
 * in one place before the wizard closes. It runs no probe of its own.
 */
export function HealthStep() {
  const relay = relayCheck(useRelayHealth().health);
  const connection = useConnectionCheck();
  const uplinks = uplinksCheck(useUplinkReadiness());
  const rows = [
    { name: "Container", check: relay },
    { name: "KSP connection", check: connection },
    { name: "Uplinks", check: uplinks },
  ];
  const checks = rows.map((row) => row.check);
  const plumbingBad = [relay, connection].some((check) =>
    SETTLED_BAD.includes(check.state),
  );

  return (
    <Stack gap="related-comfortable">
      <Text level="muted" size="sm">
        These are the same checks as the steps before, all in one place. Go back
        to a step to fix what it reports; this page updates when a check
        changes.
      </Text>
      <LiveRegion as="div">
        <Text weight="semibold">{verdict(checks)}</Text>
      </LiveRegion>
      <RowList>
        {rows.map((row) => (
          <li key={row.name}>
            <CheckName>{row.name}</CheckName>
            <CheckReading check={row.check} />
          </li>
        ))}
      </RowList>
      {plumbingBad && (
        <Hint>
          <span>
            The container's own log usually says why something is not working:
          </span>
          <CommandBlock
            command={CONTAINER_LOGS_COMMAND}
            label="container log command"
          />
          <span>
            <DocLink href={SETUP_LINKS.telemetryChecks}>
              Checking telemetry is arriving
            </DocLink>{" "}
            walks the KSP side, and{" "}
            <DocLink href={SETUP_LINKS.networking}>
              the networking guide
            </DocLink>{" "}
            covers running KSP on another computer.
          </span>
        </Hint>
      )}
      {uplinks.state === "attention" && (
        <Hint>
          <span>
            Go back to the Uplinks step: each row there says why it is not
            working. Uplinks are optional, so this does not stop Gonogo.
          </span>
        </Hint>
      )}
    </Stack>
  );
}

const RowList = styled.ul`
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--gap-related-comfortable);

  li {
    display: flex;
    flex-direction: column;
    gap: var(--gap-label-value);
  }
`;

const CheckName = styled.span`
  font-size: var(--font-size-caption);
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: var(--color-text-muted);
`;
