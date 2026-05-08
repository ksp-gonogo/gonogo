import type { FogMaskStore, StoredMask } from "@gonogo/data";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FogSyncHostService } from "../fog/FogSyncHostService";
import type { PeerHostService } from "../peer/PeerHostService";
import type { PeerMessage } from "../peer/protocol";

// Hand-rolled fakes mirror the surface FogSyncHostService actually
// touches. The service ignores everything else on PeerHostService and
// FogMaskStore, so the cast back to the real types is a deliberate
// "trust me, this is enough" — much cheaper than mocking the full
// interfaces just to satisfy structural type checks.
interface FakeHost {
  service: PeerHostService;
  firePeerConnect: (peerId: string) => void;
  sentMessages: Array<{ peerId: string; msg: PeerMessage }>;
}

function makeFakeHost(): FakeHost {
  const subs = new Set<(peerId: string) => void>();
  const sentMessages: FakeHost["sentMessages"] = [];
  const fake = {
    onPeerConnect: (cb: (peerId: string) => void) => {
      subs.add(cb);
      return () => subs.delete(cb);
    },
    sendToPeer: (peerId: string, msg: PeerMessage) => {
      sentMessages.push({ peerId, msg });
    },
  };
  return {
    service: fake as unknown as PeerHostService,
    firePeerConnect: (peerId) => {
      for (const cb of subs) cb(peerId);
    },
    sentMessages,
  };
}

function makeStoredMask(
  profileId: string,
  bodyId: string,
  data: number[],
  width = 2,
  height = 1,
): StoredMask {
  return {
    key: `${profileId}:${bodyId}`,
    version: 1,
    width,
    height,
    data: new Uint8Array(data),
    updatedAt: 0,
  };
}

interface FakeFogStore {
  loadAllForProfile: ReturnType<typeof vi.fn>;
}

function makeFakeFogStore(masks: StoredMask[] = []): FakeFogStore {
  return {
    loadAllForProfile: vi.fn().mockResolvedValue(masks),
  };
}

// flushMicrotasks lets the service's async sendSnapshot resolve before
// we make assertions. The host fakes synchronously fire
// `peerConnectListeners`, but the service kicks off a Promise chain
// (load → send) — one queued microtask round isn't enough; await a
// macrotask via setTimeout 0 to drain the queue reliably.
const flushMacrotask = () => new Promise<void>((r) => setTimeout(r, 0));

describe("FogSyncHostService", () => {
  let host: FakeHost;
  let fogStore: FakeFogStore;

  beforeEach(() => {
    host = makeFakeHost();
    fogStore = makeFakeFogStore();
  });

  it("sends a fog-snapshot to the connecting peer with all stored masks", async () => {
    fogStore = makeFakeFogStore([
      makeStoredMask("p1", "Kerbin", [1, 2, 3, 4]),
      makeStoredMask("p1", "Mun", [5, 6]),
    ]);

    const sync = new FogSyncHostService({
      peerHost: host.service,
      fogStore: fogStore as unknown as FogMaskStore,
      getActiveProfileId: () => "p1",
    });
    sync.start();

    host.firePeerConnect("station-A");
    await flushMacrotask();

    expect(host.sentMessages).toHaveLength(1);
    const sent = host.sentMessages[0];
    expect(sent.peerId).toBe("station-A");
    expect(sent.msg.type).toBe("fog-snapshot");
    if (sent.msg.type !== "fog-snapshot") throw new Error("type guard");
    expect(sent.msg.profileId).toBe("p1");
    expect(sent.msg.masks).toHaveLength(2);
    const byBody = new Map(
      sent.msg.masks.map((m) => [m.bodyId, Array.from(m.data)]),
    );
    expect(byBody.get("Kerbin")).toEqual([1, 2, 3, 4]);
    expect(byBody.get("Mun")).toEqual([5, 6]);
    expect(fogStore.loadAllForProfile).toHaveBeenCalledWith("p1");
  });

  it("sends nothing when the active profile has no stored masks", async () => {
    const sync = new FogSyncHostService({
      peerHost: host.service,
      fogStore: fogStore as unknown as FogMaskStore,
      getActiveProfileId: () => "fresh-profile",
    });
    sync.start();

    host.firePeerConnect("station-A");
    await flushMacrotask();

    expect(host.sentMessages).toEqual([]);
  });

  it("targets only the connecting peer, not all connected peers", async () => {
    fogStore = makeFakeFogStore([makeStoredMask("p1", "Kerbin", [1])]);
    const sync = new FogSyncHostService({
      peerHost: host.service,
      fogStore: fogStore as unknown as FogMaskStore,
      getActiveProfileId: () => "p1",
    });
    sync.start();

    host.firePeerConnect("station-A");
    host.firePeerConnect("station-B");
    await flushMacrotask();

    expect(host.sentMessages).toHaveLength(2);
    expect(host.sentMessages.map((m) => m.peerId).sort()).toEqual([
      "station-A",
      "station-B",
    ]);
  });

  it("re-reads the active profile id on each connect (so a profile switch picks up the new masks)", async () => {
    const profiles = ["p-old", "p-new"];
    let i = 0;
    const sync = new FogSyncHostService({
      peerHost: host.service,
      fogStore: fogStore as unknown as FogMaskStore,
      getActiveProfileId: () => profiles[i++],
    });
    sync.start();

    host.firePeerConnect("station-A");
    host.firePeerConnect("station-B");
    await flushMacrotask();

    expect(fogStore.loadAllForProfile).toHaveBeenNthCalledWith(1, "p-old");
    expect(fogStore.loadAllForProfile).toHaveBeenNthCalledWith(2, "p-new");
  });

  it("swallows fog-store errors so a transient persist failure can't crash the host", async () => {
    fogStore.loadAllForProfile.mockRejectedValueOnce(new Error("disk full"));
    const sync = new FogSyncHostService({
      peerHost: host.service,
      fogStore: fogStore as unknown as FogMaskStore,
      getActiveProfileId: () => "p1",
    });
    sync.start();

    host.firePeerConnect("station-A");
    await flushMacrotask();

    expect(host.sentMessages).toEqual([]);
    // Still wired up afterwards — a one-off failure shouldn't poison
    // future connects.
    fogStore.loadAllForProfile.mockResolvedValueOnce([
      makeStoredMask("p1", "Kerbin", [1]),
    ]);
    host.firePeerConnect("station-B");
    await flushMacrotask();

    expect(host.sentMessages).toHaveLength(1);
    expect(host.sentMessages[0].peerId).toBe("station-B");
  });

  it("stop() detaches from the host so later connects don't fire snapshots", async () => {
    fogStore = makeFakeFogStore([makeStoredMask("p1", "Kerbin", [1])]);
    const sync = new FogSyncHostService({
      peerHost: host.service,
      fogStore: fogStore as unknown as FogMaskStore,
      getActiveProfileId: () => "p1",
    });
    sync.start();
    sync.stop();

    host.firePeerConnect("station-A");
    await flushMacrotask();

    expect(host.sentMessages).toEqual([]);
    expect(fogStore.loadAllForProfile).not.toHaveBeenCalled();
  });

  it("start() is idempotent — double-start doesn't double-send", async () => {
    fogStore = makeFakeFogStore([makeStoredMask("p1", "Kerbin", [1])]);
    const sync = new FogSyncHostService({
      peerHost: host.service,
      fogStore: fogStore as unknown as FogMaskStore,
      getActiveProfileId: () => "p1",
    });
    sync.start();
    sync.start();

    host.firePeerConnect("station-A");
    await flushMacrotask();

    expect(host.sentMessages).toHaveLength(1);
  });
});
