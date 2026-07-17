import { renderHook } from "@ksp-gonogo/test-utils";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it } from "vitest";
import {
  MISSION_HISTORY_ENABLED_SETTING,
  MISSION_RECORD_ALL_TOPICS_SETTING,
  MISSION_VIDEO_RECORDING_ENABLED_SETTING,
  useMissionHistorySettings,
} from "./missionHistorySettings";
import { __clearSettingsForTests } from "./registry";
import { SettingsProvider } from "./SettingsContext";
import { SettingsService } from "./SettingsService";

function memoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
    clear: () => map.clear(),
    key: () => null,
    get length() {
      return map.size;
    },
  };
}

function wrapper(service: SettingsService) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <SettingsProvider service={service}>{children}</SettingsProvider>;
  };
}

describe("useMissionHistorySettings", () => {
  beforeEach(() => {
    __clearSettingsForTests();
  });

  it("defaults: history on, both sub-toggles off", () => {
    const service = new SettingsService(memoryStorage());
    const { result } = renderHook(() => useMissionHistorySettings(), {
      wrapper: wrapper(service),
    });
    expect(result.current).toEqual({
      missionHistoryEnabled: true,
      recordAllTopics: false,
      videoRecordingEnabled: false,
    });
  });

  it("recordAllTopics/videoRecordingEnabled are inert (always false) while history itself is off, even if their own stored value is true", () => {
    const service = new SettingsService(memoryStorage());
    service.set(MISSION_HISTORY_ENABLED_SETTING, false);
    service.set(MISSION_RECORD_ALL_TOPICS_SETTING, true);
    service.set(MISSION_VIDEO_RECORDING_ENABLED_SETTING, true);

    const { result } = renderHook(() => useMissionHistorySettings(), {
      wrapper: wrapper(service),
    });
    expect(result.current).toEqual({
      missionHistoryEnabled: false,
      recordAllTopics: false,
      videoRecordingEnabled: false,
    });
  });

  it("recordAllTopics turns on once both it and the parent are enabled", () => {
    const service = new SettingsService(memoryStorage());
    service.set(MISSION_HISTORY_ENABLED_SETTING, true);
    service.set(MISSION_RECORD_ALL_TOPICS_SETTING, true);

    const { result } = renderHook(() => useMissionHistorySettings(), {
      wrapper: wrapper(service),
    });
    expect(result.current.recordAllTopics).toBe(true);
    expect(result.current.videoRecordingEnabled).toBe(false);
  });
});
