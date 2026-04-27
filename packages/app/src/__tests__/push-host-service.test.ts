import { describe, expect, it, vi } from "vitest";
import type { PeerHostService } from "../peer/PeerHostService";
import type { PeerMessage } from "../peer/protocol";
import { PushHostService } from "../pushToMain/PushHostService";

// Thin fake — just the handlers PushHostService subscribes to.
interface FakeHost {
  service: PeerHostService;
  firePush: (
    peerId: string,
    msg: Extract<PeerMessage, { type: "widget-push" }>,
  ) => void;
  fireRecall: (peerId: string, widgetInstanceId: string) => void;
  fireStationInfo: (peerId: string, name: string) => void;
  firePeerDisconnect: (peerId: string) => void;
}

function makeFakeHost(): FakeHost {
  const pushSubs = new Set<
    (p: string, m: Extract<PeerMessage, { type: "widget-push" }>) => void
  >();
  const recallSubs = new Set<(p: string, id: string) => void>();
  const stationSubs = new Set<
    (
      p: string,
      info: { name: string; version?: string; buildTime?: string },
    ) => void
  >();
  const disconnectSubs = new Set<(p: string) => void>();

  const fake = {
    onWidgetPush: (cb: Parameters<PeerHostService["onWidgetPush"]>[0]) => {
      pushSubs.add(cb);
      return () => pushSubs.delete(cb);
    },
    onWidgetRecall: (cb: Parameters<PeerHostService["onWidgetRecall"]>[0]) => {
      recallSubs.add(cb);
      return () => recallSubs.delete(cb);
    },
    onStationInfo: (cb: Parameters<PeerHostService["onStationInfo"]>[0]) => {
      stationSubs.add(cb);
      return () => stationSubs.delete(cb);
    },
    onPeerDisconnect: (
      cb: Parameters<PeerHostService["onPeerDisconnect"]>[0],
    ) => {
      disconnectSubs.add(cb);
      return () => disconnectSubs.delete(cb);
    },
  };

  return {
    service: fake as unknown as PeerHostService,
    firePush: (p, m) => {
      for (const cb of pushSubs) cb(p, m);
    },
    fireRecall: (p, id) => {
      for (const cb of recallSubs) cb(p, id);
    },
    fireStationInfo: (p, n) => {
      for (const cb of stationSubs) cb(p, { name: n });
    },
    firePeerDisconnect: (p) => {
      for (const cb of disconnectSubs) cb(p);
    },
  };
}

function pushMsg(
  widgetInstanceId: string,
  overrides: Partial<Extract<PeerMessage, { type: "widget-push" }>> = {},
): Extract<PeerMessage, { type: "widget-push" }> {
  return {
    type: "widget-push",
    widgetInstanceId,
    componentId: "map-view",
    config: { trajectoryLength: 2000 },
    width: 6,
    height: 4,
    ...overrides,
  };
}

describe("PushHostService", () => {
  it("captures a pushed widget and fires a change notification", () => {
    const fake = makeFakeHost();
    const svc = new PushHostService(fake.service);
    const changes = vi.fn();
    svc.onChange(changes);

    fake.fireStationInfo("peer-A", "LDO");
    fake.firePush("peer-A", pushMsg("w1"));

    expect(svc.snapshot()).toHaveLength(1);
    expect(svc.snapshot()[0]).toMatchObject({
      peerId: "peer-A",
      widgetInstanceId: "w1",
      componentId: "map-view",
      width: 6,
      height: 4,
      stationName: "LDO",
    });
    expect(changes).toHaveBeenCalled();
  });

  it("patches station name on late-arriving station-info", () => {
    const fake = makeFakeHost();
    const svc = new PushHostService(fake.service);

    // Push first, station-info after.
    fake.firePush("peer-A", pushMsg("w1"));
    expect(svc.snapshot()[0].stationName).toBe("Station");

    fake.fireStationInfo("peer-A", "Flight Director");
    expect(svc.snapshot()[0].stationName).toBe("Flight Director");
  });

  it("removes on recall", () => {
    const fake = makeFakeHost();
    const svc = new PushHostService(fake.service);

    fake.firePush("peer-A", pushMsg("w1"));
    fake.firePush("peer-A", pushMsg("w2"));
    expect(svc.snapshot()).toHaveLength(2);

    fake.fireRecall("peer-A", "w1");
    expect(svc.snapshot().map((w) => w.widgetInstanceId)).toEqual(["w2"]);
  });

  it("drops all entries for a peer when it disconnects", () => {
    const fake = makeFakeHost();
    const svc = new PushHostService(fake.service);

    fake.firePush("peer-A", pushMsg("w1"));
    fake.firePush("peer-B", pushMsg("w2"));
    fake.firePush("peer-A", pushMsg("w3"));
    expect(svc.snapshot()).toHaveLength(3);

    fake.firePeerDisconnect("peer-A");
    expect(svc.snapshot().map((w) => w.peerId)).toEqual(["peer-B"]);
  });

  it("re-pushing the same (peer, widgetInstanceId) replaces the config", () => {
    const fake = makeFakeHost();
    const svc = new PushHostService(fake.service);

    fake.firePush("peer-A", pushMsg("w1", { config: { v: 1 } }));
    fake.firePush("peer-A", pushMsg("w1", { config: { v: 2 } }));

    expect(svc.snapshot()).toHaveLength(1);
    expect(svc.snapshot()[0].config).toEqual({ v: 2 });
  });

  it("main-side dismiss removes the entry and notifies", () => {
    const fake = makeFakeHost();
    const svc = new PushHostService(fake.service);
    fake.firePush("peer-A", pushMsg("w1"));

    const changes = vi.fn();
    svc.onChange(changes);
    svc.dismiss("peer-A", "w1");
    expect(svc.snapshot()).toHaveLength(0);
    expect(changes).toHaveBeenCalledWith([]);
  });

  it("dispose detaches listeners — no more notifications", () => {
    const fake = makeFakeHost();
    const svc = new PushHostService(fake.service);
    const changes = vi.fn();
    svc.onChange(changes);

    svc.dispose();
    fake.firePush("peer-A", pushMsg("w1"));
    expect(changes).not.toHaveBeenCalled();
  });
});
