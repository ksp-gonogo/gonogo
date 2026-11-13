import { describe, expect, it, vi } from "vitest";
import { PeerClientService } from "../peer/PeerClientService";
import type { PeerMessage } from "../peer/protocol";
import { AlarmClientService } from "./AlarmClientService";
import { AlarmPeerBridge, type AlarmPeerHost } from "./AlarmPeerBridge";

function linkStub() {
  return {
    onAlarmSnapshot: vi.fn(() => () => {}),
    onAlarmFired: vi.fn(() => () => {}),
    sendAlarmControl: vi.fn(),
    sendAlarmWarpIntent: vi.fn(),
  };
}

function asLink(stub: ReturnType<typeof linkStub>): PeerClientService {
  return Object.assign(Object.create(PeerClientService.prototype), stub);
}

describe("AlarmClientService banner controls", () => {
  it("sends each control to the host rather than acting locally", () => {
    const link = linkStub();
    const service = new AlarmClientService(asLink(link));

    service.beginWarpTo();
    service.beginWarpToFirstSignal();
    service.cancelWarpTo();
    service.acknowledgeAlarmsCancelled();
    service.setWarpSafetyMargin(12);

    expect(link.sendAlarmControl.mock.calls).toEqual([
      ["warp-to-begin"],
      ["warp-to-first-signal"],
      ["warp-to-cancel"],
      ["acknowledge-cancelled"],
      ["warp-margin", 12],
    ]);
  });

  it("announces its own warp press at the rate the host last reported", () => {
    const link = linkStub();
    const service = new AlarmClientService(asLink(link));
    service.announceWarpIntent();
    expect(link.sendAlarmWarpIntent).toHaveBeenCalledWith(0);
  });
});

describe("AlarmPeerBridge alarm-control", () => {
  it("routes each control message to the host's handler", () => {
    let deliver:
      | ((
          peerId: string,
          msg: Extract<PeerMessage, { type: "alarm-control" }>,
        ) => void)
      | null = null;
    const noop = () => () => {};
    const host: AlarmPeerHost = {
      onPeerConnect: noop,
      onAlarmAdd: noop,
      onAlarmUpdate: noop,
      onAlarmDelete: noop,
      onAlarmAcknowledge: noop,
      onAlarmAckUnscheduledWarp: noop,
      onAlarmWarpIntent: noop,
      onAlarmControl: (cb) => {
        deliver = cb;
        return () => {};
      },
      sendToPeer: () => {},
      broadcast: () => {},
    };
    const calls: string[] = [];
    new AlarmPeerBridge(host, {
      addAlarm: () => {},
      updateAlarm: () => {},
      deleteAlarm: () => {},
      acknowledgeAlarm: () => {},
      acknowledgeUnscheduledWarp: () => {},
      registerStationWarpIntent: () => {},
      acknowledgeAlarmsCancelled: () => calls.push("ack-cancelled"),
      beginWarpTo: () => calls.push("begin"),
      beginWarpToFirstSignal: () => calls.push("first-signal"),
      cancelWarpTo: () => calls.push("cancel"),
      setWarpSafetyMargin: (s) => calls.push(`margin ${s}`),
      getSnapshot: () => {
        throw new Error("unused");
      },
    });

    const send = (
      action: Extract<PeerMessage, { type: "alarm-control" }>["action"],
      seconds?: number,
    ) => deliver?.("p", { type: "alarm-control", action, seconds });
    send("warp-to-begin");
    send("warp-to-first-signal");
    send("warp-to-cancel");
    send("acknowledge-cancelled");
    send("warp-margin", 9);
    send("warp-margin");

    expect(calls).toEqual([
      "begin",
      "first-signal",
      "cancel",
      "ack-cancelled",
      "margin 9",
    ]);
  });
});
