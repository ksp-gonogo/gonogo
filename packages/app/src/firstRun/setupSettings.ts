import { useTelemetry } from "@ksp-gonogo/core";
import { CORE_OWNER } from "../settings/GonogoSettings";

/** The tag a declared setting carries to be offered among the first-run setup's recommended settings. */
export const SETUP_SETTING_TAG = "setup";

/**
 * Every owner with a setting tagged for the setup, the mod's own first and then
 * each Uplink in the order the mod lists its rows. Empty until the mod has
 * reported its settings.
 */
export function useSetupSettingOwners(): string[] {
  const reading = useTelemetry("settings.gonogo");
  if (reading.state !== "observed" && reading.state !== "held") return [];
  const owners: string[] = [];
  for (const row of reading.value.rows) {
    if (
      (row.tags ?? []).includes(SETUP_SETTING_TAG) &&
      !owners.includes(row.owner)
    )
      owners.push(row.owner);
  }
  return owners.sort(
    (a, b) => Number(b === CORE_OWNER) - Number(a === CORE_OWNER),
  );
}

/** Whether any declared setting is tagged for the setup. False until the mod has reported its settings. */
export function useHasSetupSettings(): boolean {
  return useSetupSettingOwners().length > 0;
}
