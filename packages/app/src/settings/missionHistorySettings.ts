import { useSetting } from "./SettingsContext";

/**
 * What mission history records. The settings are the game's, kept in KSP's
 * settings file under `CONSOLE/` by these ids, and read here from the copy
 * `ConsoleSettingsFromHost` keeps.
 */
export const MISSION_HISTORY_ENABLED_SETTING = "mission.historyEnabled";
export const MISSION_RECORD_ALL_TOPICS_SETTING = "mission.recordAllTopics";
export const MISSION_VIDEO_RECORDING_ENABLED_SETTING =
  "mission.videoRecordingEnabled";

export interface MissionHistorySettings {
  missionHistoryEnabled: boolean;
  /** Already AND-combined with `missionHistoryEnabled`: inert (always `false`) whenever history itself is off, regardless of its own stored value. */
  recordAllTopics: boolean;
  /** Already AND-combined with `missionHistoryEnabled`: see `recordAllTopics`. */
  videoRecordingEnabled: boolean;
}

/**
 * Reactive read of all three mission-history settings, with the two
 * sub-toggles pre-combined against the master switch: callers never need
 * to re-derive the `historyEnabled && subToggle` AND themselves (mirrors
 * `useStationWakeLock`'s own `active && enabled` combination pattern).
 */
export function useMissionHistorySettings(): MissionHistorySettings {
  const [missionHistoryEnabled] = useSetting<boolean>(
    MISSION_HISTORY_ENABLED_SETTING,
    true,
  );
  const [recordAllTopicsRaw] = useSetting<boolean>(
    MISSION_RECORD_ALL_TOPICS_SETTING,
    false,
  );
  const [videoRecordingEnabledRaw] = useSetting<boolean>(
    MISSION_VIDEO_RECORDING_ENABLED_SETTING,
    false,
  );
  return {
    missionHistoryEnabled,
    recordAllTopics: missionHistoryEnabled && recordAllTopicsRaw,
    videoRecordingEnabled: missionHistoryEnabled && videoRecordingEnabledRaw,
  };
}
