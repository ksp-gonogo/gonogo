import { render, screen } from "@ksp-gonogo/test-utils";
import { PanelStatusStoreProvider, useStatusSummary } from "@ksp-gonogo/ui-kit";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { AlarmHostProvider } from "./AlarmHostContext";
import type { AlarmHostService } from "./AlarmHostService";
import {
  AlarmStatusBridge,
  alarmMatchesWidget,
  alarmSubjectKey,
  severityFromAlarmState,
} from "./AlarmStatusBridge";
import type { Alarm, AlarmSnapshot, AlarmState, AlarmTrigger } from "./types";

function makeAlarm(
  id: string,
  name: string,
  state: AlarmState,
  trigger: AlarmTrigger,
): Alarm {
  return { id, name, trigger, state, createdBy: "main", createdAt: 0 };
}

const threshold = (dataKey: string): AlarmTrigger => ({
  kind: "threshold",
  dataKey,
  op: ">",
  value: 0,
  sustainSeconds: 0,
});

function snapshotOf(alarms: Alarm[]): AlarmSnapshot {
  return {
    alarms,
    ut: null,
    warp: { index: 0, rate: 1, mode: "UNKNOWN" },
    unscheduledWarp: null,
    warpTo: null,
    warpSafetyMarginSeconds: 10,
  };
}

// A minimal alarm host: the bridge only reads snapshot() and subscribe().
function fakeHost(snapshot: AlarmSnapshot): AlarmHostService {
  return {
    snapshot: () => snapshot,
    subscribe: () => () => {},
  } as unknown as AlarmHostService;
}

function SummaryProbe() {
  const summary = useStatusSummary();
  return (
    <output data-testid="summary">
      {summary ? `${summary.severity}:${summary.label}` : "none"}
    </output>
  );
}

function withAlarms(snapshot: AlarmSnapshot, children: ReactNode) {
  return (
    <AlarmHostProvider service={fakeHost(snapshot)}>
      <PanelStatusStoreProvider>{children}</PanelStatusStoreProvider>
    </AlarmHostProvider>
  );
}

describe("severityFromAlarmState", () => {
  it("firing -> critical, arming -> warning, pending/fired -> no contribution", () => {
    expect(severityFromAlarmState("firing")).toBe("critical");
    expect(severityFromAlarmState("arming")).toBe("warning");
    expect(severityFromAlarmState("pending")).toBeNull();
    expect(severityFromAlarmState("fired")).toBeNull();
  });
});

describe("alarmSubjectKey / alarmMatchesWidget", () => {
  it("attributes a threshold alarm by its dataKey", () => {
    const alarm = makeAlarm("a", "ALT", "firing", threshold("vessel.altitude"));
    expect(alarmSubjectKey(alarm)).toBe("vessel.altitude");
    expect(alarmMatchesWidget(alarm, ["vessel.altitude"])).toBe(true);
    expect(alarmMatchesWidget(alarm, ["vessel.velocity"])).toBe(false);
  });

  it("attributes an event alarm by its topic and a time alarm to nothing", () => {
    const event = makeAlarm("e", "E", "firing", {
      kind: "event",
      topic: "mission.events",
    });
    expect(alarmMatchesWidget(event, ["mission.events"])).toBe(true);
    const time = makeAlarm("t", "T", "firing", {
      kind: "time",
      ut: 100,
      leadSeconds: 10,
    });
    expect(alarmSubjectKey(time)).toBeNull();
    expect(alarmMatchesWidget(time, ["anything"])).toBe(false);
  });
});

describe("AlarmStatusBridge", () => {
  it("lights the widget summary with the alarm name when a firing alarm matches", () => {
    render(
      withAlarms(
        snapshotOf([
          makeAlarm("a", "IMPACT", "firing", threshold("vessel.altitude")),
        ]),
        <>
          <AlarmStatusBridge dataRequirements={["vessel.altitude"]} />
          <SummaryProbe />
        </>,
      ),
    );
    expect(screen.getByTestId("summary")).toHaveTextContent("critical:IMPACT");
  });

  it("maps an arming alarm to warning", () => {
    render(
      withAlarms(
        snapshotOf([
          makeAlarm("a", "BURN SOON", "arming", threshold("vessel.altitude")),
        ]),
        <>
          <AlarmStatusBridge dataRequirements={["vessel.altitude"]} />
          <SummaryProbe />
        </>,
      ),
    );
    expect(screen.getByTestId("summary")).toHaveTextContent(
      "warning:BURN SOON",
    );
  });

  it("contributes nothing for a pending alarm", () => {
    render(
      withAlarms(
        snapshotOf([
          makeAlarm("a", "IMPACT", "pending", threshold("vessel.altitude")),
        ]),
        <>
          <AlarmStatusBridge dataRequirements={["vessel.altitude"]} />
          <SummaryProbe />
        </>,
      ),
    );
    expect(screen.getByTestId("summary")).toHaveTextContent("none");
  });

  it("does not light a widget whose requirements the alarm does not cover", () => {
    render(
      withAlarms(
        snapshotOf([
          makeAlarm("a", "IMPACT", "firing", threshold("vessel.altitude")),
        ]),
        <>
          <AlarmStatusBridge dataRequirements={["career.funds"]} />
          <SummaryProbe />
        </>,
      ),
    );
    expect(screen.getByTestId("summary")).toHaveTextContent("none");
  });

  it("renders nothing and stays quiet with no alarm host in the tree", () => {
    render(
      <PanelStatusStoreProvider>
        <AlarmStatusBridge dataRequirements={["vessel.altitude"]} />
        <SummaryProbe />
      </PanelStatusStoreProvider>,
    );
    expect(screen.getByTestId("summary")).toHaveTextContent("none");
  });
});
