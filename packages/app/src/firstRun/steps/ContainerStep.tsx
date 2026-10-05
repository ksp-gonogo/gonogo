import { Button, CommandBlock } from "@ksp-gonogo/ui";
import { Stack, Text } from "@ksp-gonogo/ui-kit";
import { relayCheck } from "../checks";
import { runs, say } from "../copy";
import { CONTAINER_STATUS_COMMAND, RUN_COMMAND } from "../setupGuide";
import { useRelayHealth } from "../useRelayHealth";
import { Hint, Prose, StepCheck } from "./StepParts";

/**
 * Confirms the container is up by asking its relay half. The app half needs no
 * check of its own on the usual path, since the operator is reading it; the
 * relay is the part that can be missing while this screen still renders, when
 * its port was left out of the run command or the app came from a dev server.
 */
export function ContainerStep() {
  const { health, recheck } = useRelayHealth();
  const check = relayCheck(health);

  return (
    <Stack gap="related-comfortable">
      <Text level="muted" size="sm">
        {say("container.instruction")}
      </Text>
      <CommandBlock
        command={RUN_COMMAND}
        label={say("container.runCommandLabel")}
      />
      <StepCheck check={check} />
      {check.state === "fail" && (
        <Hint>
          <span>{say("container.hint.status")}</span>
          <CommandBlock
            command={CONTAINER_STATUS_COMMAND}
            label={say("container.statusCommandLabel")}
          />
          <span>
            <Prose runs={runs("container.hint.fix")} />
          </span>
          <div>
            <Button variant="ghost" type="button" onClick={recheck}>
              {say("container.recheck")}
            </Button>
          </div>
        </Hint>
      )}
    </Stack>
  );
}
