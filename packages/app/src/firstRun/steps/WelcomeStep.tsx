import { Stack, Text } from "@ksp-gonogo/ui-kit";

/**
 * The first thing a new operator reads, and the only place in the flow that
 * explains a word rather than reporting a value.
 *
 * The copy names no Uplink on purpose. Listing a few of them dates the moment
 * it is written, reads as an endorsement of those over the rest, and says
 * nothing an operator who has not met the word "Uplink" needs; what they need
 * is what an Uplink IS.
 */
export function WelcomeStep() {
  return (
    <Stack gap="sm">
      <Text tone="muted" size="sm">
        An Uplink adds the widgets and telemetry for one mod. The mod installed
        in KSP reports it, and its client half runs here in the browser.
      </Text>
      <Text tone="muted" size="sm">
        This checks the connection to your mod, then reports which of the
        Uplinks it has installed have a client loaded.
      </Text>
    </Stack>
  );
}
