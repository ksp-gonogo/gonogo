import { Stack, Text } from "@ksp-gonogo/ui-kit";
import { say } from "../copy";

/**
 * Closes the flow by saying what to do next and where the same readings live
 * from now on. This runs once per browser, so it has to hand the operator the
 * permanent surface rather than assume they will find it.
 */
export function DoneStep() {
  return (
    <Stack gap="related-dense">
      <Text level="muted" size="sm">
        {say("done.next")}
      </Text>
      <Text level="muted" size="sm">
        {say("done.settings")}
      </Text>
    </Stack>
  );
}
