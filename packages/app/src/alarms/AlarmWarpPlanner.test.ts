import { describe, expect, it } from "vitest";
import { AlarmWarpPlanner } from "./AlarmWarpPlanner";
import type { Alarm } from "./types";

const base = {
  name: "alarm",
  state: "pending",
  createdBy: "main",
  createdAt: 0,
} as const;

function planner(alarms: Alarm[], ut = 1_000, owlt = 0) {
  return new AlarmWarpPlanner(
    () => alarms,
    () => ut,
    () => owlt,
  );
}

describe("AlarmWarpPlanner", () => {
  it("plans toward a time alarm's own instant minus its lead", () => {
    const time: Alarm = {
      ...base,
      id: "t",
      trigger: { kind: "time", ut: 2_000, leadSeconds: 10 },
    };

    const found = planner([time]).findClosestPendingTrackableAlarm();

    expect(found?.remainingGameSeconds).toBe(990);
  });

  it("plans toward the instant the mod last read for an alarm that follows a Topic", () => {
    const follow: Alarm = {
      ...base,
      id: "f",
      trigger: {
        kind: "instant",
        topic: "career.status",
        fieldPath: "x",
        leadSeconds: 30,
      },
      followedUT: 1_500,
    };

    const found = planner(
      [follow],
      1_000,
      20,
    ).findClosestPendingTrackableAlarm();

    expect(found?.alarm.id).toBe("f");
    expect(found?.remainingGameSeconds).toBe(450);
  });

  it("is no target until the mod has read an instant", () => {
    const follow: Alarm = {
      ...base,
      id: "f",
      trigger: {
        kind: "instant",
        topic: "career.status",
        fieldPath: "x",
        leadSeconds: 30,
      },
    };

    expect(planner([follow]).findClosestPendingTrackableAlarm()).toBeNull();
    expect(planner([follow]).findEligiblePendingAlarm()).toBeNull();
  });

  it("takes the nearer of a time alarm and a followed instant", () => {
    const time: Alarm = {
      ...base,
      id: "t",
      trigger: { kind: "time", ut: 5_000, leadSeconds: 10 },
    };
    const follow: Alarm = {
      ...base,
      id: "f",
      trigger: {
        kind: "instant",
        topic: "career.status",
        fieldPath: "x",
        leadSeconds: 10,
      },
      followedUT: 1_200,
    };

    expect(
      planner([time, follow]).findClosestPendingTrackableAlarm()?.alarm.id,
    ).toBe("f");
  });
});
