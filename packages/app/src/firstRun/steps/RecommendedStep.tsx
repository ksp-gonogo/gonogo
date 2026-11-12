import { SectionTitle, Stack, Text } from "@ksp-gonogo/ui-kit";
import { GonogoSettings } from "../../settings/GonogoSettings";
import { ModSettingsSection } from "../../settings/ModSettingsSection";
import {
  SETUP_SETTING_TAG,
  type SettingsHome,
  useSettingsHomes,
} from "../../settings/settingsHomes";
import { say } from "../copy";
import { useRegisterLeaveSave } from "../leaveGuard";

/**
 * The settings the mod and its Uplinks recommend choosing before first use,
 * under the name of whichever recommends them. It offers only settings the
 * Settings window shows, drawn from the same list of places Settings draws them
 * and by the same forms, so a setting cannot be recommended here without being
 * in Settings. A row of Gonogo's settings file is saved as the player leaves
 * the step; a host mod setting, which belongs to the loaded save, is written
 * at once, and one an Uplink locks shows its value with which Uplink locks it
 * and why.
 */
export function RecommendedStep() {
  const homes = useSettingsHomes().filter((home) => home.setup);
  const registerLeaveSave = useRegisterLeaveSave();
  const names: string[] = [];
  for (const home of homes) {
    if (!names.includes(home.name)) names.push(home.name);
  }
  return (
    <Stack gap="related-comfortable">
      <Text level="muted" size="sm">
        {say("recommended.intro")}
      </Text>
      {names.map((name) => (
        <Stack as="section" key={name} gap="related-dense">
          <SectionTitle as="h3" $rule>
            {name}
          </SectionTitle>
          {homes
            .filter((home) => home.name === name)
            .map((home) => (
              <RecommendedHome
                key={`${home.kind}:${home.id}`}
                home={home}
                registerLeaveSave={registerLeaveSave}
              />
            ))}
        </Stack>
      ))}
    </Stack>
  );
}

function RecommendedHome({
  home,
  registerLeaveSave,
}: {
  home: SettingsHome;
  registerLeaveSave: ReturnType<typeof useRegisterLeaveSave>;
}) {
  return home.kind === "gonogo" ? (
    <GonogoSettings
      owner={home.id}
      tag={SETUP_SETTING_TAG}
      registerLeaveSave={registerLeaveSave}
      showSavedAt={false}
    />
  ) : (
    <ModSettingsSection
      uplinkId={home.id}
      name={home.name}
      tag={SETUP_SETTING_TAG}
    />
  );
}
