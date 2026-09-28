import type { ModSettingsModel } from "../__generated__/contract";
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
