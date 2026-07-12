import { registerSetting } from "./registry";
import { useSetting } from "./SettingsContext";

export const MISSION_HISTORY_ENABLED_SETTING = "mission.historyEnabled";
export const MISSION_RECORD_ALL_TOPICS_SETTING = "mission.recordAllTopics";
export const MISSION_VIDEO_RECORDING_ENABLED_SETTING =
  "mission.videoRecordingEnabled";

registerSetting({
  id: MISSION_HISTORY_ENABLED_SETTING,
  type: "boolean",
  label: "Record mission history",
  description:
    "Lets the Flight History panel record the live stream as a replayable mission. Subscription-scoped by default — it only captures the topics your dashboard already carries, so this is cheap to leave on.",
  category: "Mission History",
  defaultValue: true,
  screens: ["main"],
});

registerSetting({
  id: MISSION_RECORD_ALL_TOPICS_SETTING,
  type: "boolean",
  label: "Record every telemetry topic",
  description:
    "Subscribes to every telemetry topic while recording, not just what the dashboard has open, so a replay can surface any widget's history. Trades completeness for cost: raises the mod's produce load and the recording's size. Off by default.",
  category: "Mission History",
  defaultValue: false,
  screens: ["main"],
  dependsOn: MISSION_HISTORY_ENABLED_SETTING,
});

registerSetting({
  id: MISSION_VIDEO_RECORDING_ENABLED_SETTING,
  type: "boolean",
  label: "Record camera video with missions",
  description:
    "Captures the connected camera feed alongside telemetry, synchronized for replay. Not yet implemented — this toggle reserves the setting for that fast-follow.",
  category: "Mission History",
  defaultValue: false,
  screens: ["main"],
  dependsOn: MISSION_HISTORY_ENABLED_SETTING,
});

export interface MissionHistorySettings {
  missionHistoryEnabled: boolean;
  /** Already AND-combined with `missionHistoryEnabled` — inert (always `false`) whenever history itself is off, regardless of its own stored value. */
  recordAllTopics: boolean;
  /** Already AND-combined with `missionHistoryEnabled` — see `recordAllTopics`. */
  videoRecordingEnabled: boolean;
}

/**
 * Reactive read of all three mission-history settings, with the two
 * sub-toggles pre-combined against the master switch — callers never need
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
