import { CommandBlock } from "@ksp-gonogo/ui";
import { Stack, Text } from "@ksp-gonogo/ui-kit";
import { SitrepConnection } from "../../settings/SitrepConnection";
import { isWindows, MOD_LOG_COMMAND, SETUP_LINKS } from "../setupGuide";
import { useConnectionCheck } from "../useConnectionCheck";
import { DocLink, Hint, HintList, StepCheck } from "./StepParts";

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
        Start KSP with the Gonogo mod installed. The mod starts with the game,
        so reaching the main menu is enough. If KSP runs on another computer,
        press the gear on the row below and set Host to that computer's address.
      </Text>
      <Text level="muted" size="sm">
        To confirm the mod started, run this in your KSP install folder. A
        working start prints a line beginning "[Gonogo] Started".
      </Text>
      <CommandBlock
        command={isWindows() ? MOD_LOG_COMMAND.windows : MOD_LOG_COMMAND.posix}
        label="mod log command"
      />
      <SitrepConnection />
      <StepCheck check={check} />
      {check.state === "fail" && (
        <Hint>
          <HintList>
            <li>KSP is not running yet: start it and wait for the main menu</li>
            <li>
              The command above prints nothing: the mod is not installed. The{" "}
              <DocLink href={SETUP_LINKS.kspSetup}>KSP setup guide</DocLink>{" "}
              covers installing it
            </li>
            <li>
              The command prints "[Gonogo] Started" and this still fails: the
              Host is wrong, or a firewall on the KSP computer is blocking port
              8090. See the{" "}
              <DocLink href={SETUP_LINKS.networking}>networking guide</DocLink>
            </li>
          </HintList>
        </Hint>
      )}
    </Stack>
  );
}
