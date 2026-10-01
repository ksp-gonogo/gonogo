import { type ModSettingsModel, SettingKind } from "../__generated__/contract";
import type { TopicReading } from "../reading";
import { useStream } from "./use-stream";

/**
 * The topic an Uplink's host mod settings ride: `settings.<uplinkId>`. It
 * exists only for an Uplink whose `system.uplinks` entry says `modSettings`.
 */
export function modSettingsTopic(uplinkId: string): string {
  return `settings.${uplinkId}`;
}

/**
 * One Uplink's host mod settings, as the Uplink read them off the mod. The
 * topic is declared per Uplink at runtime, so it has no `TopicId`; this is the
 * typed read over it. Change a writable one with the `settings.mod.write`
 * command, and read whether it landed here rather than from the reply.
 */
export function useModSettings(
  uplinkId: string,
): TopicReading<ModSettingsModel> {
  return useStream<ModSettingsModel>(modSettingsTopic(uplinkId));
}

/**
 * One setting's value off a `settings.<uplink>` payload, parsed by the kind the
 * mod listed it as: `True`/`False` to a boolean, a number to a number, text as
 * it is. `undefined` when the setting is not listed, its value cannot be read,
 * or the text does not parse as its kind.
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
