import { CommandBlock } from "@ksp-gonogo/ui";
import { Stack, Text } from "@ksp-gonogo/ui-kit";
import { SitrepConnection } from "../../settings/SitrepConnection";
import { runs, say } from "../copy";
import {
  ADDRESS_COMMAND,
  browserSystem,
  isWindows,
  MOD_LOG_COMMAND,
} from "../setupGuide";
import {
  useConnectionCheck,
  useKspOnThisComputer,
} from "../useConnectionCheck";
import { Hint, HintList, Prose, StepCheck } from "./StepParts";

const ADDRESS_SYSTEMS = ["windows", "macos", "linux"] as const;

/**
 * The address command for this browser's system alone, or all three when the
 * browser does not say which it is. The KSP computer need not be this one, so
 * the full list is the fallback rather than a guess.
 */
function addressSystems(): readonly (typeof ADDRESS_SYSTEMS)[number][] {
  const own = browserSystem();
  return own ? [own] : ADDRESS_SYSTEMS;
}

/**
 * The connect step embeds the same host row the Settings Connection tab
 * renders (`SitrepConnection`, which lives in its own file for
 * exactly this reuse), so an operator meets one connection control, not two
 * that could drift.
 *
 * The step leads with its check. Once connected it adds only what matters
 * after the fact: the pause caveat when KSP shares this computer. Everything for fixing a connection waits for a failure.
 * The host row stays through a retry because it holds a half-typed host.
 *
 * Moving on does not require a connected status. The next step reports "waiting
 * for the mod" as a state of its own, which is a reading, not an error.
 */
export function ConnectStep() {
  const check = useConnectionCheck();
  const sameComputer = useKspOnThisComputer();
  const failed = check.state === "fail";

  return (
    <Stack gap="related-comfortable">
      <StepCheck check={check} />
      {check.state === "pass" && sameComputer && (
        <Text level="muted" size="sm">
          {say("connect.twoComputers")}
        </Text>
      )}
      {failed && (
        <>
          <Text level="muted" size="sm">
            {say("connect.instruction")}
          </Text>
          <Text level="muted" size="sm">
            {say("connect.confirm")}
          </Text>
          <CommandBlock
            command={
              isWindows() ? MOD_LOG_COMMAND.windows : MOD_LOG_COMMAND.posix
            }
            label={say("connect.logCommandLabel")}
          />
        </>
      )}
      {check.state !== "pass" && <SitrepConnection />}
      {failed && (
        <Hint>
          <HintList>
            <li>{say("connect.hint.notRunning")}</li>
            <li>
              <Prose runs={runs("connect.hint.notInstalled")} />
            </li>
            <li>
              <Prose runs={runs("connect.hint.blocked")} />
            </li>
            <li>
              <Stack gap="related">
                <span>{say("connect.hint.address")}</span>
                {addressSystems().map((system) => (
                  <Stack key={system} gap="related-dense">
                    <span>{say(`connect.address.${system}`)}</span>
                    <CommandBlock
                      command={ADDRESS_COMMAND[system]}
                      label={say("connect.addressCommandLabel")}
                    />
                  </Stack>
                ))}
              </Stack>
            </li>
          </HintList>
        </Hint>
      )}
    </Stack>
  );
}
