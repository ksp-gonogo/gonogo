import { CommandBlock } from "@ksp-gonogo/ui";
import { LiveRegion, Stack, Text } from "@ksp-gonogo/ui-kit";
import styled from "styled-components";
import {
  type CheckState,
  relayCheck,
  type SetupCheck,
  uplinksCheck,
} from "../checks";
import { runs, say } from "../copy";
import { CONTAINER_LOGS_COMMAND } from "../setupGuide";
import { useConnectionCheck } from "../useConnectionCheck";
import { useRelayHealth } from "../useRelayHealth";
import { useUplinkReadiness } from "../useUplinkReadiness";
import { CheckReading, Hint, Prose } from "./StepParts";

const SETTLED_BAD: readonly CheckState[] = ["fail", "attention"];

function verdict(checks: readonly SetupCheck[]): string {
  if (checks.some((check) => check.state === "checking"))
    return say("health.verdict.checking");
  const bad = checks.filter((check) => SETTLED_BAD.includes(check.state));
  if (bad.length === 0) return say("health.verdict.allWorking");
  return say("health.verdict.needLook", {
    bad: bad.length,
    total: checks.length,
  });
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
    { name: say("health.row.container"), check: relay },
    { name: say("health.row.connection"), check: connection },
    { name: say("health.row.uplinks"), check: uplinks },
  ];
  const checks = rows.map((row) => row.check);
  const plumbingBad = [relay, connection].some((check) =>
    SETTLED_BAD.includes(check.state),
  );

  return (
    <Stack gap="related-comfortable">
      <Text level="muted" size="sm">
        {say("health.intro")}
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
          <span>{say("health.hint.log")}</span>
          <CommandBlock
            command={CONTAINER_LOGS_COMMAND}
            label={say("health.logCommandLabel")}
          />
          <span>
            <Prose runs={runs("health.hint.guides")} />
          </span>
        </Hint>
      )}
      {uplinks.state === "attention" && (
        <Hint>
          <span>{say("health.hint.uplinks")}</span>
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
