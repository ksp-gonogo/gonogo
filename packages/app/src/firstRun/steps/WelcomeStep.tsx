import { Stack, Text } from "@ksp-gonogo/ui-kit";
import { say } from "../copy";

/**
 * The first thing a new operator reads: what the two halves of Gonogo are, and
 * what the steps after this one are about to do with them.
 *
 * The copy names no Uplink on purpose. Listing a few of them dates the moment
 * it is written and reads as an endorsement of those over the rest.
 */
export function WelcomeStep() {
  return (
    <Stack gap="related-dense">
      <Text level="muted" size="sm">
        {say("welcome.parts")}
      </Text>
      <Text level="muted" size="sm">
        {say("welcome.steps")}
      </Text>
      <Text level="muted" size="sm">
        {say("welcome.noBlock")}
      </Text>
    </Stack>
  );
}
