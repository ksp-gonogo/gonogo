import { Button, CommandBlock } from "@ksp-gonogo/ui";
import { Stack, Text } from "@ksp-gonogo/ui-kit";
import { relayCheck } from "../checks";
import {
  CONTAINER_STATUS_COMMAND,
  RUN_COMMAND,
  SETUP_LINKS,
} from "../setupGuide";
import { useRelayHealth } from "../useRelayHealth";
import { DocLink, Hint, StepCheck } from "./StepParts";

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
        Start the Gonogo container. It serves this app and the relay that lets
        other screens join yours. If it is already running, there is nothing to
        do here.
      </Text>
      <CommandBlock command={RUN_COMMAND} label="run command" />
      <StepCheck check={check} />
      {check.state === "fail" && (
        <Hint>
          <span>
            This checks again every few seconds. To see whether the container is
            running:
          </span>
          <CommandBlock
            command={CONTAINER_STATUS_COMMAND}
            label="container status command"
          />
          <span>
            If that lists no container, run the first command. If it lists one,
            port 3002 was not published: remove the container and run the first
            command again, unchanged. The{" "}
            <DocLink href={SETUP_LINKS.deployment}>deployment guide</DocLink>{" "}
            covers the relay and its ports.
          </span>
          <div>
            <Button variant="ghost" type="button" onClick={recheck}>
              Check again
            </Button>
          </div>
        </Hint>
      )}
    </Stack>
  );
}
