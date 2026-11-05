import { memoryStorage } from "@ksp-gonogo/core/test";
import { afterEach, describe, expect, it } from "vitest";
import { PeerClientService } from "../peer/PeerClientService";
import type { PeerHostService } from "../peer/PeerHostService";
import type { PeerMessage } from "../peer/protocol";
import { AlarmClientService } from "./AlarmClientService";
import { AlarmHostService } from "./AlarmHostService";
import type { AlarmSnapshot } from "./types";

type Handler = (...args: never[]) => void;

/** A host and its stations wired in memory: what a station sends reaches the host, what the host broadcasts reaches every station. */
function room() {
  const handlers = new Map<string, Set<Handler>>();
  const stations = new Map<string, (snap: AlarmSnapshot) => void>();
  const on = (name: string) => (cb: Handler) => {
    const set = handlers.get(name) ?? new Set<Handler>();
    handlers.set(name, set);
    set.add(cb);
    return () => {
      set.delete(cb);
    };
  };
  const emit = (name: string, peerId: string, ...args: unknown[]) => {
    for (const cb of handlers.get(name) ?? []) {
      (cb as (...a: unknown[]) => void)(peerId, ...args);
    }
  };
  const host = {
    onPeerConnect: on("connect") as PeerHostService["onPeerConnect"],
    onAlarmAdd: on("add") as PeerHostService["onAlarmAdd"],
    onAlarmUpdate: on("update") as PeerHostService["onAlarmUpdate"],
    onAlarmDelete: on("delete") as PeerHostService["onAlarmDelete"],
    onAlarmAcknowledge: on("ack") as PeerHostService["onAlarmAcknowledge"],
    onAlarmAckUnscheduledWarp: on(
      "ackUnscheduled",
    ) as PeerHostService["onAlarmAckUnscheduledWarp"],
    onAlarmWarpIntent: on("warpIntent") as PeerHostService["onAlarmWarpIntent"],
    onAlarmControl: on("control") as PeerHostService["onAlarmControl"],
    sendToPeer: (peerId: string, msg: PeerMessage) => {
      if (msg.type === "alarm-snapshot") stations.get(peerId)?.(msg.snapshot);
    },
    broadcast: (msg: PeerMessage) => {
      if (msg.type !== "alarm-snapshot") return;
      for (const deliver of stations.values()) deliver(msg.snapshot);
    },
  } as PeerHostService;

  return {
    host,
    join(peerId: string): AlarmClientService {
      let deliver: (snap: AlarmSnapshot) => void = () => {};
      const link = Object.assign(Object.create(PeerClientService.prototype), {
        onAlarmSnapshot: (cb: (snap: AlarmSnapshot) => void) => {
          deliver = cb;
        },
        onAlarmFired: () => {},
        sendAlarmAcknowledge: (id: string) => emit("ack", peerId, id),
      });
      const client = new AlarmClientService(link);
      stations.set(peerId, (snap) => deliver(snap));
      emit("connect", peerId);
      return client;
    },
  };
}

function stored(id: string, state: "firing" | "fired", ut: number) {
  return {
    id,
    name: id,
    trigger: { kind: "time", ut, leadSeconds: 0 },
    state,
    createdBy: "main",
    createdAt: 0,
    matchSinceUT: ut,
  };
}

const ids = (snap: AlarmSnapshot) => snap.alarms.map((a) => a.id).sort();

describe("acknowledging a fired alarm", () => {
  let service: AlarmHostService | null = null;
  afterEach(() => service?.dispose());

  function start() {
    const storage = memoryStorage();
    storage.setItem(
      "gonogo.alarms.list",
      JSON.stringify([
        stored("firing-one", "firing", 1000),
        stored("fired-one", "fired", 1001),
        stored("fired-two", "fired", 1002),
        stored("fired-three", "fired", 1003),
      ]),
    );
    const r = room();
    service = new AlarmHostService(r.host, {
      storage,
      tickIntervalMs: 3_600_000,
    });
    return { r, service };
  }

  it("clears one alarm on the main screen and every station when a station acknowledges it", () => {
    const { r, service } = start();
    const a = r.join("station-a");
    const b = r.join("station-b");

    a.acknowledgeAlarm("fired-one");
    a.acknowledgeAlarm("firing-one");

    const expected = ["fired-three", "fired-two"];
    expect(ids(service.snapshot())).toEqual(expected);
    expect(ids(a.snapshot())).toEqual(expected);
    expect(ids(b.snapshot())).toEqual(expected);
  });

  it("clears every alarm everywhere when a station acknowledges all of them", () => {
    const { r, service } = start();
    const a = r.join("station-a");
    const b = r.join("station-b");

    for (const alarm of a.snapshot().alarms) a.acknowledgeAlarm(alarm.id);

    expect(ids(service.snapshot())).toEqual([]);
    expect(ids(a.snapshot())).toEqual([]);
    expect(ids(b.snapshot())).toEqual([]);
  });

  it("clears on every station when the main screen acknowledges", () => {
    const { r, service } = start();
    const a = r.join("station-a");
    const b = r.join("station-b");

    service.acknowledgeAlarm("fired-two");
    service.acknowledgeAlarm("firing-one");
    expect(ids(a.snapshot())).toEqual(["fired-one", "fired-three"]);
    expect(ids(b.snapshot())).toEqual(["fired-one", "fired-three"]);

    for (const alarm of service.snapshot().alarms) {
      service.acknowledgeAlarm(alarm.id);
    }
    expect(ids(a.snapshot())).toEqual([]);
    expect(ids(b.snapshot())).toEqual([]);
  });

  it("lists nothing to a station that joins after every alarm was acknowledged, and shows what is left to one that joins before", () => {
    const { r, service } = start();
    const early = r.join("station-early");
    service.acknowledgeAlarm("fired-one");

    const late = r.join("station-late");
    expect(ids(late.snapshot())).toEqual([
      "fired-three",
      "fired-two",
      "firing-one",
    ]);

    late.acknowledgeAlarm("fired-two");
    for (const alarm of service.snapshot().alarms) {
      service.acknowledgeAlarm(alarm.id);
    }
    expect(ids(early.snapshot())).toEqual([]);
    expect(ids(late.snapshot())).toEqual([]);
    expect(ids(r.join("station-later").snapshot())).toEqual([]);
  });
});
