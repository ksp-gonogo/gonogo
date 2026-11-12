import { SETUP_SETTING_TAG, useSettingsHomes } from "../settings/settingsHomes";

export { SETUP_SETTING_TAG };

/** Whether any place in Settings holds a setting tagged for the setup. False until the mod has reported its settings. */
export function useHasSetupSettings(): boolean {
  return useSettingsHomes().some((home) => home.setup);
}
