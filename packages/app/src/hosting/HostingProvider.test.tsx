import { memoryStorage } from "@ksp-gonogo/core/test";
import { LocalStorageStore } from "@ksp-gonogo/data";
import { getActiveTelemetryClient } from "@ksp-gonogo/sitrep-client";
import type { ClientMessage } from "@ksp-gonogo/sitrep-sdk";
import { StubTransport } from "@ksp-gonogo/sitrep-sdk/testing";
import { render } from "@ksp-gonogo/test-utils";
import { act } from "react";
import { describe, expect, it } from "vitest";
import { ScetAlarmBridge } from "../alarms/ScetAlarmBridge";
import type { Alarm } from "../alarms/types";
import { SitrepTelemetryProvider } from "../telemetry/SitrepTelemetryProvider";
import { buildGonogoHost } from "../uplinks/host";
import {
  HostingProvider,
  PlainStationFeed,
  useHostingHosts,
} from "./HostingProvider";
import { getRegisteredHostJobs } from "./HostJobs";

const CENTRE_B = "ground:Outpost B";

/** A transport that keeps every message the client sent, not only the commands. */
class RecordingTransport extends StubTransport {
  readonly frames: ClientMessage[] = [];

  override send(message: ClientMessage): void {
    this.frames.push(message);
    super.send(message);
  }

  vantagesSet(): string[] {
    return this.frames.flatMap((m) =>
      m.type === "set-vantage" ? [m.centreId] : [],
    );
  }
}

/**
 * A hosting screen: the hosting piece with its jobs connection, and the screen's
 * own display session beneath it, each on a transport of its own.
 */
async function mountHostingScreen() {
  const jobsTransport = new RecordingTransport();
  const displayTransport = new RecordingTransport();
  render(
    <HostingProvider ownsMesh openTransport={() => jobsTransport}>
      <SitrepTelemetryProvider transport={displayTransport} screenKey="hosting">
        <PlainStationFeed ownsMesh />
      </SitrepTelemetryProvider>
    </HostingProvider>,
  );
  await act(async () => {});
  const jobs = getRegisteredHostJobs();
  const display = getActiveTelemetryClient();
  if (!jobs?.client || !display)
    throw new Error("hosting screen did not mount");
  return {
    jobs,
    jobsClient: jobs.client,
    display,
    jobsTransport,
    displayTransport,
  };
}

describe("the hosting piece's connection", () => {
  it("is a connection of its own, apart from the display session", async () => {
    const { jobsClient, display } = await mountHostingScreen();

    expect(jobsClient).not.toBe(display);
  });

  it("sends no set-vantage when the main screen picks another centre, and stays where the mod put it", async () => {
    const { jobsClient, display, jobsTransport, displayTransport } =
      await mountHostingScreen();

    act(() => display.setVantage(CENTRE_B));

    expect(displayTransport.vantagesSet()).toEqual([CENTRE_B]);
    expect(jobsTransport.vantagesSet()).toEqual([]);
    expect(jobsClient.selectedVantage).toBeUndefined();
  });

  it("names the display session to the jobs as the one plain stations read, following the picker", async () => {
    const { jobs, display } = await mountHostingScreen();
    expect(jobs.plainStationVantage()).toBe("");

    act(() => display.setVantage(CENTRE_B));

    expect(jobs.plainStationVantage()).toBe(CENTRE_B);
    expect(jobs.alarmVantage()).toBe(CENTRE_B);
  });

  it("carries alarm arming and disarming while the picker is elsewhere, armed at the centre the picker chose", async () => {
    const { jobs, display, jobsTransport, displayTransport } =
      await mountHostingScreen();
    act(() => display.setVantage(CENTRE_B));
    const bridge = new ScetAlarmBridge({
      hostJobs: jobs,
      getAlarms: () => [],
      onFired: () => {},
      onForeignFired: () => {},
      onArmRefused: () => {},
      onArmAccepted: () => {},
      onOtherSave: () => {},
      onSaveLearned: () => {},
      armedIds: new LocalStorageStore<readonly string[]>({
        key: "armed",
        defaults: [],
        storage: memoryStorage(),
      }),
      onRoster: () => {},
      onCancelled: () => {},
      onDeletedInGame: () => {},
      onEditedInGame: () => {},
      nowMs: () => 0,
    });
    const alarm: Alarm = {
      id: "a1",
      name: "Contract",
      trigger: {
        kind: "contract-parameter",
        contractId: "c1",
        parameterTitle: "Land",
        targetState: "Complete",
        sustainSeconds: 0,
      },
      state: "pending",
      createdBy: "main",
      createdAt: 0,
    };

    bridge.arm(alarm);
    bridge.disarm("a1");

    expect(
      jobsTransport.sentCommands.map((c) => [c.command, c.vantage]),
    ).toEqual([
      ["alarm.scet.arm", CENTRE_B],
      ["alarm.scet.disarm", CENTRE_B],
    ]);
    expect(jobsTransport.sentCommands[0].args).toMatchObject({
      vantage: CENTRE_B,
    });
    expect(displayTransport.sentCommands).toEqual([]);
    bridge.dispose();
  });
});

describe("the callers that mean the host's client", () => {
  it("hand the Uplinks' host handle the jobs connection while the display provider is mounted, not the display session", async () => {
    const { jobsTransport, displayTransport, display } =
      await mountHostingScreen();
    const handle = buildGonogoHost().getActiveTelemetryClient();

    expect(getActiveTelemetryClient()).toBe(display);
    expect(handle).toBeDefined();
    handle?.dispatch("vessel.control.stage", {});

    expect(jobsTransport.sentCommands).toHaveLength(1);
    expect(displayTransport.sentCommands).toHaveLength(0);
  });

  it("send a command through the Uplink host handle from the centre the picker chose", async () => {
    const { display, jobsTransport } = await mountHostingScreen();
    act(() => display.setVantage(CENTRE_B));

    buildGonogoHost()
      .getActiveTelemetryClient()
      ?.dispatch("vessel.control.stage", {});
    expect(jobsTransport.sentCommands.map((c) => c.vantage)).toEqual([
      CENTRE_B,
    ]);
    expect(jobsTransport.vantagesSet()).toEqual([]);
  });

  it("leave a command at home while the picker has chosen no centre", async () => {
    const { jobsTransport } = await mountHostingScreen();

    buildGonogoHost()
      .getActiveTelemetryClient()
      ?.dispatch("vessel.control.stage", {});

    expect(jobsTransport.sentCommands.map((c) => c.vantage)).toEqual([""]);
  });
});

describe("the services a hosting piece builds", () => {
  function Probe({ seen }: { seen: { alarm?: unknown; notes?: unknown } }) {
    const hosts = useHostingHosts();
    seen.alarm = hosts?.alarmHost;
    seen.notes = hosts?.notesHost;
    return null;
  }

  it("include the alarm list and the notes on a host, and neither on a joined screen", async () => {
    const hostSeen: { alarm?: unknown; notes?: unknown } = {};
    const joinedSeen: { alarm?: unknown; notes?: unknown } = {};
    render(
      <>
        <HostingProvider ownsMesh openTransport={() => new StubTransport()}>
          <Probe seen={hostSeen} />
        </HostingProvider>
        <HostingProvider ownsMesh={false}>
          <Probe seen={joinedSeen} />
        </HostingProvider>
      </>,
    );
    await act(async () => {});
    expect(hostSeen.alarm).toBeTruthy();
    expect(hostSeen.notes).toBeTruthy();
    expect(joinedSeen.alarm).toBeNull();
    expect(joinedSeen.notes).toBeNull();
  });
});
