import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Listener = (...args: unknown[]) => void;

// Minimal FakePeer mirroring peer-host-service.test.ts — fires "open"
// asynchronously so start()'s open handler (which POSTs to the relay) runs.
class FakePeer {
  private listeners = new Map<string, Listener[]>();
  static last: FakePeer | null = null;

  constructor(_id?: string) {
    FakePeer.last = this;
    queueMicrotask(() => this.emit("open", "FAKE-PEER-ID"));
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
  destroy() {}
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

describe("PeerHostService — relay host registration", () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    FakePeer.last = null;
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

  it("POSTs { shareCode, peerId } to /host on the PeerJS open", async () => {
    const { PeerHostService } = await import("../peer/PeerHostService");
    const service = new PeerHostService();
    await service.start();
    // Flush the open microtask + the async registerWithRelay it kicks off.
    await new Promise((r) => setTimeout(r, 0));

    const posts = hostPosts(fetchSpy);
    expect(posts.length).toBeGreaterThanOrEqual(1);
    const body = bodyOf(posts[0]);
    expect(body.shareCode).toBe(service.shareCode);
    expect(body.peerId).toBe("FAKE-PEER-ID");
    expect(service.relayRegistered).toBe(true);
    service.stop();
  });

  it("re-POSTs on the heartbeat interval (kept alive within the relay TTL)", async () => {
    vi.useFakeTimers();
    const { PeerHostService } = await import("../peer/PeerHostService");
    const service = new PeerHostService();
    void service.start();
    // Settle start()'s awaited /ice-config fetch + the open microtask.
    await vi.advanceTimersByTimeAsync(0);

    const afterOpen = hostPosts(fetchSpy).length;
    expect(afterOpen).toBeGreaterThanOrEqual(1);

    // Two heartbeat cadences (~30s each) → at least two more POSTs.
    await vi.advanceTimersByTimeAsync(30_000);
    await vi.advanceTimersByTimeAsync(30_000);
    const afterHeartbeats = hostPosts(fetchSpy).length;
    expect(afterHeartbeats).toBeGreaterThanOrEqual(afterOpen + 2);

    // stop() clears the heartbeat — no further POSTs after teardown.
    service.stop();
    const afterStop = hostPosts(fetchSpy).length;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(hostPosts(fetchSpy).length).toBe(afterStop);
  });

  it("the share-code is stable and distinct from the peer id, persisted under its own key", async () => {
    const { PeerHostService } = await import("../peer/PeerHostService");
    const a = new PeerHostService();
    const persisted = localStorage.getItem("gonogo-host-share-code");
    expect(persisted).toBe(a.shareCode);
    expect(a.shareCode).toMatch(/^[A-Z0-9]{4}$/);

    // A second service instance reads the SAME persisted share-code.
    const b = new PeerHostService();
    expect(b.shareCode).toBe(a.shareCode);
  });

  it("pre-registers the NEW peer id with the relay during a graceful rotation, before tearing the old Peer down", async () => {
    const { PeerHostService } = await import("../peer/PeerHostService");
    const service = new PeerHostService();
    await service.start();
    await new Promise((r) => setTimeout(r, 0));

    const before = hostPosts(fetchSpy).length;
    // Graceful rotation (the unavailable-id-after-open recovery path). The
    // new id should be POSTed under the unchanged share-code so a station
    // re-resolving mid-rotation lands on the fresh id rather than the
    // stale one the relay would otherwise still hold.
    await service.rotatePeerIdGracefully("test-rotation");

    const posts = hostPosts(fetchSpy);
    expect(posts.length).toBeGreaterThan(before);
    // Among the rotation-era POSTs, one carries a NEW (4-char) peer id that
    // is NOT the old "FAKE-PEER-ID", under the SAME share-code.
    const rotated = posts
      .map((c) => bodyOf(c))
      .find((b) => b.peerId !== "FAKE-PEER-ID" && b.peerId !== undefined);
    expect(rotated).toBeDefined();
    expect(rotated?.shareCode).toBe(service.shareCode);
    expect(rotated?.peerId).toMatch(/^[A-Z0-9]{4}$/);
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
    await new Promise((r) => setTimeout(r, 0));

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
      // /host POST rejects — relay down.
      return Promise.reject(new Error("ECONNREFUSED"));
    });

    const { PeerHostService } = await import("../peer/PeerHostService");
    const service = new PeerHostService();
    await expect(service.start()).resolves.toBeUndefined();
    await new Promise((r) => setTimeout(r, 0));
    expect(service.relayRegistered).toBe(false);
    service.stop();
  });
});
