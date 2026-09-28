import { Stack, Text } from "@ksp-gonogo/ui-kit";

/**
 * Closes the flow by saying where the same readings live from now on. This runs
 * once per browser, so it has to hand the operator the permanent surface rather
 * than assume they will find it.
 */
export function DoneStep() {
  return (
    <Stack gap="related-dense">
      <Text level="muted" size="sm">
        Settings carries the same readings from now on: the mod connection under
        Connection, and each Uplink's health and whether its client loaded on
        its own page under Uplinks.
      </Text>
    </Stack>
  );
}
