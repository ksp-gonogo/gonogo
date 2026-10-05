import { Stack, Text } from "@ksp-gonogo/ui-kit";

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
        Gonogo has two parts. This app runs in a container on your computer. The
        Gonogo mod runs inside KSP and sends the game's data to it.
      </Text>
      <Text level="muted" size="sm">
        The next steps check each part in turn: the container, the connection to
        KSP, and any Uplinks you have installed. Each step shows the command to
        run and then checks the result for you.
      </Text>
      <Text level="muted" size="sm">
        No step blocks the next, so you can carry on and come back to anything
        that is not ready yet.
      </Text>
    </Stack>
  );
}
