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

/**
 * The properties a widget's `dataRequirements` migration off the legacy
 * vocabulary has to preserve. Attribution used to be three string equalities
 * against a legacy key, so it survived only while the widget kept declaring
 * that key: swapping in the modern topic the widget actually reads silently
 * detached every alarm from it. Probing the supposedly-finished exemplar is
 * what surfaced that; reading it did not.
 */
describe("alarm attribution survives the vocabulary migration", () => {
  const funds = makeAlarm("f", "FUNDS", "firing", threshold("career.funds"));
  const bodies = makeAlarm("b", "BODIES", "firing", threshold("b.number"));
  const apoapsis = makeAlarm("o", "AP", "firing", threshold("o.ApA"));

  it("matches a widget declaring the field subtopic the key maps to", () => {
    expect(alarmMatchesWidget(funds, ["career.status.economy.funds"])).toBe(
      true,
    );
    expect(alarmMatchesWidget(bodies, ["system.state.bodyCount"])).toBe(true);
    expect(alarmMatchesWidget(apoapsis, ["vessel.state.apoapsisAlt"])).toBe(
      true,
    );
  });

  it("matches a widget declaring the whole channel that field belongs to", () => {
    // A widget reading an entire payload (`useTelemetry("career.status")`,
    // `useStream("vessel.state")`) draws the field, so an alarm on it is
    // about that widget. Containment walks DOWN from the declaration to its
    // fields, never up from a derived field to its inputs: the latter would
    // light every widget declaring `vessel.comms` for an apoapsis alarm.
    expect(alarmMatchesWidget(funds, ["career.status"])).toBe(true);
    expect(alarmMatchesWidget(apoapsis, ["vessel.state"])).toBe(true);
    expect(alarmMatchesWidget(bodies, ["system.state"])).toBe(true);
  });

  it("does not match a sibling channel or a partial segment", () => {
    expect(alarmMatchesWidget(funds, ["career.statusboard"])).toBe(false);
    expect(alarmMatchesWidget(funds, ["career.status.contracts"])).toBe(false);
    expect(alarmMatchesWidget(apoapsis, ["vessel.comms"])).toBe(false);
  });

  it("keeps matching a widget that has not migrated yet", () => {
    expect(alarmMatchesWidget(funds, ["career.funds"])).toBe(true);
    expect(alarmMatchesWidget(bodies, ["b.number"])).toBe(true);
  });

  it("attributes a contract-parameter alarm without a legacy key", () => {
    const contract = makeAlarm("c", "CONTRACT", "firing", {
      kind: "contract-parameter",
      contractId: 1,
      parameterTitle: "Reach orbit",
      targetState: "Complete",
      sustainSeconds: 0,
    });
    // The subject is the app's own hardcoded string, not something an
    // operator ever picked, so it has no business being a legacy key.
    expect(alarmSubjectKey(contract)).toBe("career.status.contracts.active");
    expect(
      alarmMatchesWidget(contract, ["career.status.contracts.active"]),
    ).toBe(true);
    expect(alarmMatchesWidget(contract, ["career.status"])).toBe(true);
    // and the widgets that have not migrated off the legacy key yet
    expect(alarmMatchesWidget(contract, ["contracts.active"])).toBe(true);
  });

  it("attributes an alarm to LandingStatus, which no alarm could reach", () => {
    // LandingStatus's real declarations, the pattern every migrated widget
    // was going to copy. It reads `vessel.state` wholesale via `useStream`
    // and declared only that channel's raw INPUTS, so its own descent alarms
    // matched nothing at all.
    const landingStatus = [
      "vessel.orbit",
      "vessel.identity",
      "system.bodies",
      "vessel.target",
      "vessel.flight",
      "vessel.surface",
      "vessel.propulsion",
      "vessel.landing",
      "dv.summary",
      "dv.stages",
      "vessel.structure",
      "comms.delay",
      "vessel.state",
    ];
    const impact = makeAlarm(
      "i",
      "IMPACT",
      "firing",
      threshold("land.timeToImpact"),
    );
    expect(alarmMatchesWidget(impact, landingStatus)).toBe(true);
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
