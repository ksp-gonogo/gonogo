import { Stack, Text } from "@ksp-gonogo/ui-kit";

/**
 * Closes the flow by saying what to do next and where the same readings live
 * from now on. This runs once per browser, so it has to hand the operator the
 * permanent surface rather than assume they will find it.
 */
export function DoneStep() {
  return (
    <Stack gap="related-dense">
      <Text level="muted" size="sm">
        Load a save in KSP, then press the + button in the bottom-right corner
        of the dashboard to add widgets.
      </Text>
      <Text level="muted" size="sm">
        This setup opens only once. Settings, behind that same + button, carries
        the same readings from now on: the KSP connection under Connection, and
        each Uplink's health and whether its client loaded on its own page under
        Uplinks.
      </Text>
    </Stack>
  );
}
