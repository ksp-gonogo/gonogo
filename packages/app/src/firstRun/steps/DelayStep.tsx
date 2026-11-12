import { Stack, Text } from "@ksp-gonogo/ui-kit";
import { ModSettingsSection } from "../../settings/ModSettingsSection";
import { say } from "../copy";

/**
 * Whether to play with signal delay. The choice belongs to the loaded save, so
 * the step draws the same switch and light speed field as the comms Uplink's
 * page in Settings, which write the save through the mod. Until a save is
 * loaded the rows say so and cannot be changed.
 */
export function DelayStep() {
  return (
    <Stack gap="related-comfortable">
      <Text level="muted" size="sm">
        {say("delay.instruction")}
      </Text>
      <ModSettingsSection uplinkId="comms" name={say("delay.owner")} />
      <Text level="muted" size="sm">
        {say("delay.later")}
      </Text>
    </Stack>
  );
}
