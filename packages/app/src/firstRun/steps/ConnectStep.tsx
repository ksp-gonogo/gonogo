import { CommandBlock } from "@ksp-gonogo/ui";
import { Stack, Text } from "@ksp-gonogo/ui-kit";
import { SitrepConnection } from "../../settings/SitrepConnection";
import { runs, say } from "../copy";
import { isWindows, MOD_LOG_COMMAND } from "../setupGuide";
import { useConnectionCheck } from "../useConnectionCheck";
import { Hint, HintList, Prose, StepCheck } from "./StepParts";

/**
 * The connect step embeds the SAME host row the Settings Connection tab
 * renders (`SitrepConnection`, which lives in its own file for
 * exactly this reuse), so an operator meets one connection control, not two
 * that could drift.
 *
 * Moving on does not require a connected status. The next step reports "waiting
 * for the mod" as a state of its own, which is a reading, not an error.
 */
export function ConnectStep() {
  const check = useConnectionCheck();

  return (
    <Stack gap="related-comfortable">
      <Text level="muted" size="sm">
        {say("connect.instruction")}
      </Text>
      <Text level="muted" size="sm">
        {say("connect.confirm")}
      </Text>
      <CommandBlock
        command={isWindows() ? MOD_LOG_COMMAND.windows : MOD_LOG_COMMAND.posix}
        label={say("connect.logCommandLabel")}
      />
      <SitrepConnection />
      <StepCheck check={check} />
      {check.state === "fail" && (
        <Hint>
          <HintList>
            <li>{say("connect.hint.notRunning")}</li>
            <li>
              <Prose runs={runs("connect.hint.notInstalled")} />
            </li>
            <li>
              <Prose runs={runs("connect.hint.blocked")} />
            </li>
          </HintList>
        </Hint>
      )}
    </Stack>
  );
}
