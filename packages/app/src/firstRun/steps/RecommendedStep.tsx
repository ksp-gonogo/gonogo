import { SectionTitle, Stack, Text } from "@ksp-gonogo/ui-kit";
import { CORE_OWNER, GonogoSettings } from "../../settings/GonogoSettings";
import { say } from "../copy";
import { useRegisterLeaveSave } from "../leaveGuard";
import { SETUP_SETTING_TAG, useSetupSettingOwners } from "../setupSettings";
import { useUplinkReadiness } from "../useUplinkReadiness";

/**
 * The settings the mod and its Uplinks recommend choosing before first use,
 * under the name of whichever recommends them. Each group is drawn and saved
 * by the same form the settings modal uses for that owner, and what is left
 * unsaved is saved as the player leaves the step.
 */
export function RecommendedStep() {
  const owners = useSetupSettingOwners();
  const { entries } = useUplinkReadiness();
  const registerLeaveSave = useRegisterLeaveSave();
  return (
    <Stack gap="related-comfortable">
      <Text level="muted" size="sm">
        {say("recommended.intro")}
      </Text>
      {owners.map((owner) => (
        <Stack as="section" key={owner} gap="related-dense">
          <SectionTitle as="h3" $rule>
            {owner === CORE_OWNER
              ? say("recommended.coreOwner")
              : (entries.find((entry) => entry.id === owner)?.name ?? owner)}
          </SectionTitle>
          <GonogoSettings
            owner={owner}
            tag={SETUP_SETTING_TAG}
            registerLeaveSave={registerLeaveSave}
            showSavedAt={false}
          />
        </Stack>
      ))}
    </Stack>
  );
}
