import { type ModSettingsModel, SettingKind } from "../__generated__/contract";
import type { TopicReading } from "../reading";
import { useStream } from "./use-stream";

/**
 * The Topic name carrying one Uplink's host mod settings: `settings.<uplinkId>`.
 * Useful for subscribing to the settings an operator has set for that Uplink's
 * mod. Used by the contributions provider to read the settings a contribution
 * depends on. It exists only for an Uplink whose `system.uplinks` entry says
 * `modSettings`.
 */
export function modSettingsTopic(uplinkId: string): string {
  return `settings.${uplinkId}`;
}

/**
 * One Uplink's host mod settings as the mod reports them, read live off the
 * stream. Useful for showing the operator the current value of each setting and
 * whether a change landed. Used by the mod settings section of the app's settings
 * panel.
 *
 * The Topic is declared per Uplink at runtime, so it has no `TopicId`; this is
 * the typed read over it. Change a writable setting with the
 * `settings.mod.write` command, and read whether it landed here rather than from
 * the reply.
 */
export function useModSettings(
  uplinkId: string,
): TopicReading<ModSettingsModel> {
  // gonogo:reads settings.<uplinkId>
  return useStream<ModSettingsModel>(modSettingsTopic(uplinkId));
}

/**
 * One setting's value off a `settings.<uplink>` payload, parsed by the kind the
 * mod listed it as. Useful for gating a control on a mod setting the operator has
 * chosen. Used by the contributions provider to evaluate settings a contribution
 * depends on.
 *
 * `True`/`False` become a boolean, a number becomes a number, and text is
 * returned as it is. The result is `undefined` when the setting is not listed,
 * its value cannot be read, or the text does not parse as its kind.
 */
export function readModSetting(
  model: ModSettingsModel | null | undefined,
  key: string,
): boolean | number | string | undefined {
  const row = model?.settings.find((candidate) => candidate.id === key);
  if (row?.value === undefined || row.value === null) return undefined;
  if (row.kind === SettingKind.Bool) {
    if (row.value === "True") return true;
    if (row.value === "False") return false;
    return undefined;
  }
  if (row.kind === SettingKind.Number) {
    const parsed = Number(row.value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return row.value;
}
