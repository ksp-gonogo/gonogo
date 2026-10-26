import { Stack, Text } from "@ksp-gonogo/ui-kit";
import { say } from "../copy";

/** Closes the flow by saying what to do next, in the game and on the dashboard. */
export function DoneStep() {
  return (
    <Stack gap="related-dense">
      <Text level="muted" size="sm">
        {say("done.next")}
      </Text>
    </Stack>
  );
}
