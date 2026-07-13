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

/** Parse the `{ shareCode, peerId }` body of a captured fetch call. */
function bodyOf(call: [unknown, RequestInit?]): {
  shareCode?: string;
  peerId?: string;
} {
  const init = call[1];
  if (!init?.body) return {};
  return JSON.parse(String(init.body));
}

/** Filter a fetch spy's calls down to the relay `POST /host` registrations. */
function hostPosts(
  spy: ReturnType<typeof vi.fn>,
): Array<[unknown, RequestInit?]> {
  return (spy.mock.calls as Array<[unknown, RequestInit?]>).filter(
    ([url, init]) => String(url).endsWith("/host") && init?.method === "POST",
  );
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe("PeerHostService — stable host id (derived from share code)", () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    FakePeer.last = null;
    FakePeer.instances = [];
    localStorage.clear();
    // Default: relay accepts the registration. The /ice-config GET that
    // start() also fires gets a benign empty config so the host runs
    // STUN-only without affecting the registration assertions.
    fetchSpy = vi.fn((url: string | URL, init?: RequestInit) => {
      const u = String(url);
      if (u.endsWith("/ice-config")) {
        return Promise.resolve(
          new Response(JSON.stringify({ iceServers: [] }), { status: 200 }),
        );
      }
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

  it("POSTs { shareCode, peerId } to /host for diagnostics (discovery doesn't depend on it)", async () => {
    const { PeerHostService } = await import("../peer/PeerHostService");
    const service = new PeerHostService();
    await service.start();
    await flush();

    const posts = hostPosts(fetchSpy);
    expect(posts.length).toBeGreaterThanOrEqual(1);
    const body = bodyOf(posts[0]);
    expect(body.shareCode).toBe(service.shareCode);
    expect(body.peerId).toBe(`gonogo-host-${service.shareCode}`);
    expect(service.relayRegistered).toBe(true);
    service.stop();
  });

  it("the share-code is stable, persisted under its own key, and derives the peer id", async () => {
    const { PeerHostService } = await import("../peer/PeerHostService");
    const a = new PeerHostService();
    const persisted = localStorage.getItem("gonogo-host-share-code");
    expect(persisted).toBe(a.shareCode);
    expect(a.shareCode).toMatch(/^[A-Z0-9]{4}$/);

    // A second service instance reads the SAME persisted share-code.
    const b = new PeerHostService();
    expect(b.shareCode).toBe(a.shareCode);
  });

  it("on unavailable-id, RETRY-RECLAIMS the SAME derived id (does not rotate to a new one)", async () => {
    vi.useFakeTimers();
    const { PeerHostService } = await import("../peer/PeerHostService");
    const service = new PeerHostService();
    void service.start();
    await vi.advanceTimersByTimeAsync(0);

    const claimedId = `gonogo-host-${service.shareCode}`;
    expect(service.peerId).toBe(claimedId);
    const firstPeer = FakePeer.last;

    // Broker reports the id as taken (a stale ghost slot). The host should
    // surface "reclaiming", tear the dead Peer down, and schedule a retry
    // against the SAME derived id — never a different one.
    const reclaiming: boolean[] = [];
    const unsub = service.onReclaimingChange((r) => reclaiming.push(r));
    await vi.advanceTimersByTimeAsync(0); // flush the replay microtask
    reclaiming.length = 0;

    firstPeer?.emit("error", { type: "unavailable-id" });
    expect(service.isReclaiming()).toBe(true);
    expect(firstPeer?.destroyed).toBe(true);

    // The backoff timer fires → a fresh Peer is constructed with the SAME
    // derived id, and once it opens, reclaiming clears.
    await vi.advanceTimersByTimeAsync(1_000);
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
    // React StrictMode runs the (un-awaited) effect body twice:
    // start → stop → start. start() suspends at `await fetchHostIceServers()`
    // before constructing the Peer, so both starts can race into openPeer().
    void service.start();
    service.stop();
    void service.start();
    await flush();
    await flush();

    // Exactly one live Peer — the guard stopped the second start from
    // leaking a duplicate claiming the same derived id.
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
    // down) peer — the listener was removed. firstPeer is already destroyed
    // by stop(); a leaked listener would re-destroy a null peer or throw.
    expect(() => window.dispatchEvent(new Event("pagehide"))).not.toThrow();
    expect(firstPeer?.destroyed).toBe(true);
  });

  it("regenerateShareCode mints + persists a new code and re-claims the new derived id", async () => {
    const { PeerHostService } = await import("../peer/PeerHostService");
    const service = new PeerHostService();
    await service.start();
    await flush();

    const oldCode = service.shareCode;
    const oldPeer = FakePeer.last;

    // Observe the share-code notification the modal relies on to re-render.
    const observed: string[] = [];
    const unsub = service.onShareCodeChange((c) => observed.push(c));
    await flush(); // flush the replay microtask
    observed.length = 0;

    await service.regenerateShareCode();
    await flush();

    // The in-memory code + the persisted key both rotated.
    expect(service.shareCode).not.toBe(oldCode);
    expect(service.shareCode).toMatch(/^[A-Z0-9]{4}$/);
    expect(localStorage.getItem("gonogo-host-share-code")).toBe(
      service.shareCode,
    );
    // Listeners were notified with the new code (drives the UI re-render).
    expect(observed).toContain(service.shareCode);

    // The old derived-id Peer was destroyed and a fresh one claimed the NEW
    // derived id.
    expect(oldPeer?.destroyed).toBe(true);
    const newPeer = FakePeer.last;
    expect(newPeer).not.toBe(oldPeer);
    expect(newPeer?.id).toBe(`gonogo-host-${service.shareCode}`);
    expect(service.peerId).toBe(`gonogo-host-${service.shareCode}`);

    unsub();
    service.stop();
  });

  it("marks relayRegistered false (and never throws) when the relay rejects the POST", async () => {
    fetchSpy.mockImplementation((url: string | URL, init?: RequestInit) => {
      const u = String(url);
      if (u.endsWith("/ice-config")) {
        return Promise.resolve(
          new Response(JSON.stringify({ iceServers: [] }), { status: 200 }),
        );
      }
      if (u.endsWith("/host") && init?.method === "POST") {
        return Promise.resolve(new Response("nope", { status: 500 }));
      }
      return Promise.reject(new Error(`unmocked ${u}`));
    });

    const { PeerHostService } = await import("../peer/PeerHostService");
    const service = new PeerHostService();
    await service.start();
    await flush();

    expect(service.relayRegistered).toBe(false);
    service.stop();
  });

  it("does not throw when the relay is unreachable (fetch rejects)", async () => {
    fetchSpy.mockImplementation((url: string | URL) => {
      const u = String(url);
      if (u.endsWith("/ice-config")) {
        return Promise.resolve(
          new Response(JSON.stringify({ iceServers: [] }), { status: 200 }),
        );
      }
      // /host POST rejects — relay down. Discovery still works (derived id).
      return Promise.reject(new Error("ECONNREFUSED"));
    });

    const { PeerHostService } = await import("../peer/PeerHostService");
    const service = new PeerHostService();
    await expect(service.start()).resolves.toBeUndefined();
    await flush();
    expect(service.relayRegistered).toBe(false);
    // The host still claimed its derived id regardless of the relay.
    expect(service.peerId).toBe(`gonogo-host-${service.shareCode}`);
    service.stop();
  });
});
