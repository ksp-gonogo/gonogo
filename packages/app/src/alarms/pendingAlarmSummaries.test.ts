import { describe, expect, it } from "vitest";
import { pendingAlarmSummaries } from "./AlarmsLauncherBridge";
import type { Alarm, AlarmState, AlarmTrigger } from "./types";

function alarm(id: string, state: AlarmState, trigger: AlarmTrigger): Alarm {
  return { id, name: id, trigger, state, createdBy: "main", createdAt: 0 };
}

const at = (ut: number): AlarmTrigger => ({
  kind: "time",
  ut,
  leadSeconds: 10,
});

const threshold: AlarmTrigger = {
  kind: "threshold",
  dataKey: "vessel.flight.altitudeAsl",
  op: "<",
  value: 70_000,
  sustainSeconds: 0,
  topic: "vessel.flight",
  fieldPath: "altitudeAsl",
};

describe("pendingAlarmSummaries", () => {
  it("lists the alarms yet to fire, soonest first", () => {
    const list = pendingAlarmSummaries([
      alarm("late", "pending", at(900)),
      alarm("soon", "arming", at(100)),
      alarm("mid", "pending", at(500)),
    ]);
    expect(list.map((a) => a.id)).toEqual(["soon", "mid", "late"]);
  });

  it("leaves out an alarm that has already fired", () => {
    const list = pendingAlarmSummaries([
      alarm("firing", "firing", at(100)),
      alarm("fired", "fired", at(200)),
      alarm("left", "pending", at(300)),
    ]);
    expect(list.map((a) => a.id)).toEqual(["left"]);
  });

  it("leaves out an alarm the simulation refused, which can never end a warp", () => {
    const list = pendingAlarmSummaries(
      [
        alarm("refused", "pending", at(100)),
        alarm("armed", "pending", at(200)),
      ],
      { refused: "no SCET threshold can be read from 'vessel.state'" },
    );
    expect(list.map((a) => a.id)).toEqual(["armed"]);
  });

  it("keeps an alarm with no instant, after every one that has one", () => {
    const list = pendingAlarmSummaries([
      alarm("altitude", "pending", threshold),
      alarm("burn", "pending", at(400)),
    ]);
    expect(list).toEqual([
      { id: "burn", name: "burn", ut: 400 },
      { id: "altitude", name: "altitude", ut: null },
    ]);
  });
});
