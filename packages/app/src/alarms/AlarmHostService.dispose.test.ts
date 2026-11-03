import { memoryStorage } from "@ksp-gonogo/core/test";
import { describe, expect, it } from "vitest";
import type { PeerHostService } from "../peer/PeerHostService";
import type { PeerMessage } from "../peer/protocol";
import { AlarmHostService } from "./AlarmHostService";

type Listener = (...args: never[]) => void;

/** A peer host whose subscriptions really detach, so a leaked listener is heard. */
function livePeerHost() {
  const listeners = new Map<string, Set<Listener>>();
  const sent: unknown[] = [];
  const subscribe = (name: string) => (cb: Listener) => {
    const set = listeners.get(name) ?? new Set<Listener>();
    listeners.set(name, set);
    set.add(cb);
    return () => {
      set.delete(cb);
    };
  };
  const host = {
    onPeerConnect: subscribe("connect") as PeerHostService["onPeerConnect"],
    onAlarmAdd: subscribe("add") as PeerHostService["onAlarmAdd"],
    onAlarmUpdate: subscribe("update") as PeerHostService["onAlarmUpdate"],
    onAlarmDelete: subscribe("delete") as PeerHostService["onAlarmDelete"],
    onAlarmAcknowledge: subscribe(
      "ack",
    ) as PeerHostService["onAlarmAcknowledge"],
    onAlarmAckUnscheduledWarp: subscribe(
      "ackUnscheduled",
    ) as PeerHostService["onAlarmAckUnscheduledWarp"],
    onAlarmWarpIntent: subscribe(
      "warpIntent",
    ) as PeerHostService["onAlarmWarpIntent"],
    onAlarmControl: subscribe("control") as PeerHostService["onAlarmControl"],
    sendToPeer: (_peerId: string, msg: PeerMessage) => {
      sent.push(msg);
    },
    broadcast: (msg: PeerMessage) => {
      sent.push(msg);
    },
  } as PeerHostService;
  const emit = (name: string, ...args: unknown[]) => {
    for (const cb of [...(listeners.get(name) ?? [])]) {
      (cb as (...a: unknown[]) => void)(...args);
    }
  };
  return {
    host,
    emit,
    sent,
    count: (name: string) => listeners.get(name)?.size ?? 0,
  };
}

describe("AlarmHostService dispose", () => {
  it("hears nothing and sends nothing from a station after it is disposed", () => {
    const peer = livePeerHost();
    const service = new AlarmHostService(peer.host, {
      storage: memoryStorage(),
      tickIntervalMs: 1000,
    });
    service.dispose();
    peer.sent.length = 0;

    peer.emit("add", "station-1", {
      type: "alarm-add",
      name: "Late",
      trigger: { kind: "time", ut: 500, leadSeconds: 0 },
    });
    peer.emit("connect", "station-1");

    expect(service.snapshot().alarms).toHaveLength(0);
    expect(peer.sent).toEqual([]);
    for (const name of ["connect", "add", "update", "delete", "ack"]) {
      expect(peer.count(name)).toBe(0);
    }
  });
});
