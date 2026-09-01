import { Stack, Text } from "@ksp-gonogo/ui-kit";

/**
 * Closes the flow by saying where the same readings live from now on. This runs
 * once per browser, so it has to hand the operator the permanent surface rather
 * than assume they will find it.
 */
export function DoneStep() {
  return (
    <Stack gap="sm">
      <Text tone="muted" size="sm">
        Settings, Data Sources carries the same readings from now on: the mod
        connection, each Uplink's health, and every client the app loaded or
        refused.
      </Text>
    </Stack>
  );
}
