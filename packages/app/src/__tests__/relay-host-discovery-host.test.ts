import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Listener = (...args: unknown[]) => void;

// Minimal FakePeer that ECHOES its constructed id on open, so tests can
// assert the host claims the derived `gonogo-host-<code>` id. Tracks all
// constructed instances + whether each was destroyed.
class FakePeer {
  private listeners = new Map<string, Listener[]>();
  static instances: FakePeer[] = [];
  static last: FakePeer | null = null;
  id: string;
  destroyed = false;
  emitOpen = true;

  constructor(id?: string) {
    this.id = id ?? "";
    FakePeer.last = this;
    FakePeer.instances.push(this);
    queueMicrotask(() => {
      if (!this.destroyed && this.emitOpen) this.emit("open", this.id);
    });
  }
  on(event: string, cb: Listener) {
    const bucket = this.listeners.get(event) ?? [];
    bucket.push(cb);
    this.listeners.set(event, bucket);
  }
  emit(event: string, ...args: unknown[]) {
    this.listeners.get(event)?.forEach((cb) => {
      cb(...args);
    });
  }
  reconnect() {}
  disconnect() {}
  destroy() {
    this.destroyed = true;
  }
}

vi.mock("peerjs", () => ({ default: FakePeer }));

/** Filter a fetch spy's calls down to the relay `POST /host` calls. */
function hostPosts(
  spy: ReturnType<typeof vi.fn>,
): Array<[unknown, RequestInit?]> {
  return (spy.mock.calls as Array<[unknown, RequestInit?]>).filter(
    ([url, init]) => String(url).endsWith("/host") && init?.method === "POST",
  );
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe("PeerHostService: stable host id (derived from share code)", () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    FakePeer.last = null;
    FakePeer.instances = [];
    localStorage.clear();
    // Default: relay accepts the registration.
    fetchSpy = vi.fn((url: string | URL, init?: RequestInit) => {
      const u = String(url);
      if (u.endsWith("/host") && init?.method === "POST") {
        return Promise.resolve(new Response(JSON.stringify({ ok: true })));
      }
      return Promise.reject(new Error(`unmocked ${u}`));
    });
    vi.stubGlobal("fetch", fetchSpy);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("claims the derived gonogo-host-<shareCode> id and exposes it as peerId", async () => {
    const { PeerHostService } = await import("../peer/PeerHostService");
    const service = new PeerHostService();
    await service.start();
    await flush();

    const expectedId = `gonogo-host-${service.shareCode}`;
    // The Peer was constructed with the derived id...
    expect(FakePeer.last?.id).toBe(expectedId);
    // ...and peerId is the broker id echoed on open.
    expect(service.peerId).toBe(expectedId);
    service.stop();
  });

  it("does not POST to the relay's retired /host registry", async () => {
    const { PeerHostService } = await import("../peer/PeerHostService");
    const service = new PeerHostService();
    await service.start();
    await flush();

    expect(hostPosts(fetchSpy)).toHaveLength(0);
    service.stop();
  });

  it("hosts under the code it is given, and keeps nothing of its own in storage", async () => {
    const { PeerHostService } = await import("../peer/PeerHostService");
    const service = new PeerHostService();
    await service.adoptShareCode("QRS456");
    await service.start();
    await flush();

    expect(service.shareCode).toBe("QRS456");
    expect(FakePeer.last?.id).toBe("gonogo-host-QRS456");
    expect(localStorage.length).toBe(0);
    service.stop();
  });

  it("on unavailable-id, RETRY-RECLAIMS the SAME derived id (does not rotate to a new one)", async () => {
    vi.useFakeTimers();
    const { PeerHostService, HOST_RECLAIM_INTERVAL_MS } = await import(
      "../peer/PeerHostService"
    );
    const service = new PeerHostService();
    void service.start();
    await vi.advanceTimersByTimeAsync(0);

    const claimedId = `gonogo-host-${service.shareCode}`;
    expect(service.peerId).toBe(claimedId);
    const firstPeer = FakePeer.last;

    // Broker reports the id as taken (a stale ghost slot). The host should
    // surface "reclaiming", tear the dead Peer down, and schedule a retry
    // against the SAME derived id: never a different one.
    const reclaiming: boolean[] = [];
    const unsub = service.onReclaimingChange((r) => reclaiming.push(r));
    await vi.advanceTimersByTimeAsync(0); // flush the replay microtask
    reclaiming.length = 0;

    firstPeer?.emit("error", { type: "unavailable-id" });
    expect(service.isReclaiming()).toBe(true);
    expect(firstPeer?.destroyed).toBe(true);

    // The retry timer fires → a fresh Peer is constructed with the SAME derived id, and once it opens, reclaiming clears.
    await vi.advanceTimersByTimeAsync(HOST_RECLAIM_INTERVAL_MS);
    await vi.advanceTimersByTimeAsync(0);

    const reclaimPeer = FakePeer.last;
    expect(reclaimPeer).not.toBe(firstPeer);
    expect(reclaimPeer?.id).toBe(claimedId); // SAME id, not rotated
    expect(service.peerId).toBe(claimedId);
    expect(service.isReclaiming()).toBe(false);
    // The share code was never changed by the reclaim.
    expect(reclaiming).toContain(true);
    expect(reclaiming).toContain(false);

    unsub();
    service.stop();
  });

  it("survives a StrictMode double-start (no leaked second Peer, no reclaim loop)", async () => {
    const { PeerHostService } = await import("../peer/PeerHostService");
    const service = new PeerHostService();
    // React StrictMode runs the (un-awaited) effect body twice: start → stop → start.
    void service.start();
    service.stop();
    void service.start();
    await flush();
    await flush();

    // Exactly one live Peer: the guard stopped the second start from leaking a duplicate claiming the same derived id.
    const live = FakePeer.instances.filter((p) => !p.destroyed);
    expect(live).toHaveLength(1);
    expect(service.peerId).toBe(`gonogo-host-${service.shareCode}`);
    expect(service.isReclaiming()).toBe(false);
    service.stop();
  });

  it("frees the broker id on pagehide (clean teardown for instant reclaim on refresh)", async () => {
    const { PeerHostService } = await import("../peer/PeerHostService");
    const service = new PeerHostService();
    await service.start();
    await flush();

    const peer = FakePeer.last;
    expect(peer?.destroyed).toBe(false);

    window.dispatchEvent(new Event("pagehide"));
    expect(peer?.destroyed).toBe(true);

    // A second pagehide (or a beforeunload double-fire) is a harmless no-op.
    window.dispatchEvent(new Event("pagehide"));
    window.dispatchEvent(new Event("beforeunload"));

    service.stop();
  });

  it("removes its page-lifecycle listeners on stop (no StrictMode leak)", async () => {
    const { PeerHostService } = await import("../peer/PeerHostService");
    const service = new PeerHostService();
    await service.start();
    await flush();
    const firstPeer = FakePeer.last;
    service.stop();

    // After stop(), a stray pagehide must NOT reach into the (already torn
    // down) peer: the listener was removed. firstPeer is already destroyed
    // by stop(); a leaked listener would re-destroy a null peer or throw.
    expect(() => window.dispatchEvent(new Event("pagehide"))).not.toThrow();
    expect(firstPeer?.destroyed).toBe(true);
  });

  it("comes back under a new code the game gives it, claiming the new derived id", async () => {
    const { PeerHostService } = await import("../peer/PeerHostService");
    const service = new PeerHostService();
    await service.adoptShareCode("ABC234");
    await service.start();
    await flush();
    const oldPeer = FakePeer.last;

    const observed: string[] = [];
    const unsub = service.onShareCodeChange((c) => observed.push(c));
    await flush();
    observed.length = 0;

    await service.adoptShareCode("XYZ789");
    await flush();

    expect(observed).toEqual(["XYZ789"]);
    expect(oldPeer?.destroyed).toBe(true);
    const newPeer = FakePeer.last;
    expect(newPeer).not.toBe(oldPeer);
    expect(newPeer?.id).toBe("gonogo-host-XYZ789");
    expect(service.peerId).toBe("gonogo-host-XYZ789");

    unsub();
    service.stop();
  });

  it("does not throw when the relay is unreachable (fetch rejects)", async () => {
    // Relay down: discovery still works (derived id).
    fetchSpy.mockImplementation(() =>
      Promise.reject(new Error("ECONNREFUSED")),
    );

    const { PeerHostService } = await import("../peer/PeerHostService");
    const service = new PeerHostService();
    await expect(service.start()).resolves.toBeUndefined();
    await flush();
    // The host still claimed its derived id regardless of the relay.
    expect(service.peerId).toBe(`gonogo-host-${service.shareCode}`);
    service.stop();
  });
});
