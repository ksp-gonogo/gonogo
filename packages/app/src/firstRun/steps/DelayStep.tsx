import { Stack, Text } from "@ksp-gonogo/ui-kit";
import { ModSettingsSection } from "../../settings/ModSettingsSection";
import {
  SETUP_SETTING_TAG,
  useSettingsHomes,
} from "../../settings/settingsHomes";
import { say } from "../copy";

/** The Uplink whose host mod settings hold the save's signal delay choice. */
const COMMS = "comms";

/**
 * Whether to play with signal delay. The choice belongs to the loaded save, so
 * the step draws the comms settings exactly where and as the Settings window's
 * Gonogo tab does, writing the save through the mod; it draws nothing Settings
 * does not show. Until a save is loaded the rows say so and cannot be changed.
 * A comms setting tagged for the recommended settings step is drawn there
 * instead.
 */
export function DelayStep() {
  const home = useSettingsHomes().find(
    (candidate) => candidate.kind === "mod" && candidate.id === COMMS,
  );
  return (
    <Stack gap="related-comfortable">
      <Text level="muted" size="sm">
        {say("delay.instruction")}
      </Text>
      {home && (
        <ModSettingsSection
          uplinkId={home.id}
          name={home.name}
          withoutTag={SETUP_SETTING_TAG}
        />
      )}
      <Text level="muted" size="sm">
        {say("delay.later")}
      </Text>
    </Stack>
  );
}
