import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PeerClientService } from "../peer/PeerClientService";
import { PeerHostService } from "../peer/PeerHostService";
import type { PeerMessage } from "../peer/protocol";

type Listener = (...args: unknown[]) => void;

// Reused fake Peer / DataConnection pattern from peer-host-service.test.ts.
// Defined via vi.hoisted so the vi.mock factory can reference it despite
// the static imports above (which vitest hoists above the mock call).
const { FakePeer } = vi.hoisted(() => {
  class FakePeer {
    private listeners = new Map<string, Listener[]>();
    static last: FakePeer | null = null;
    disconnected = false;
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
    destroy() {}
  }
  return { FakePeer };
});

class FakeDataConnection {
  private listeners = new Map<string, Listener[]>();
  peer = "remote-peer";
  sent: unknown[] = [];
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
  send(msg: unknown) {
    this.sent.push(msg);
  }
  close() {}
}

vi.mock("peerjs", () => ({ default: FakePeer }));

function analyticsMsgs(conn: FakeDataConnection): PeerMessage[] {
  return (conn.sent as PeerMessage[]).filter(
    (m) => m.type === "analytics-consent",
  );
}

describe("analytics-consent over peer", () => {
  beforeEach(() => {
    FakePeer.last = null;
    localStorage.clear();
    // fetch is unused here (postAnalyticsConfig fails harmlessly); stub it
    // out so jsdom doesn't log an unhandled-rejection warning.
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new Error("no network in test"))),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("host sends current consent to a station on connect", async () => {
    const host = new PeerHostService();
    host.setAnalyticsConsent(true);
    await host.start();
    const conn = new FakeDataConnection();
    if (!FakePeer.last) throw new Error("no fake peer");
    FakePeer.last.emit("connection", conn);
    conn.emit("open");

    const msgs = analyticsMsgs(conn);
    expect(msgs).toHaveLength(1);
    expect(msgs[0]).toEqual({ type: "analytics-consent", enabled: true });
    host.stop();
  });

  it("host broadcasts a consent change to a connected station", async () => {
    const host = new PeerHostService();
    await host.start();
    const conn = new FakeDataConnection();
    if (!FakePeer.last) throw new Error("no fake peer");
    FakePeer.last.emit("connection", conn);
    conn.emit("open");
    // The on-connect send carried the default (false).
    expect(analyticsMsgs(conn)).toEqual([
      { type: "analytics-consent", enabled: false },
    ]);

    host.setAnalyticsConsent(true);
    expect(analyticsMsgs(conn)).toEqual([
      { type: "analytics-consent", enabled: false },
      { type: "analytics-consent", enabled: true },
    ]);
    host.stop();
  });

  it("does not re-broadcast when the consent value is unchanged", async () => {
    const host = new PeerHostService();
    host.setAnalyticsConsent(true);
    await host.start();
    const conn = new FakeDataConnection();
    if (!FakePeer.last) throw new Error("no fake peer");
    FakePeer.last.emit("connection", conn);
    conn.emit("open");
    host.setAnalyticsConsent(true); // no change
    expect(analyticsMsgs(conn)).toHaveLength(1);
    host.stop();
  });

  it("client applies an analytics-consent message and notifies subscribers", () => {
    const client = new PeerClientService();
    const seen: boolean[] = [];
    // Subscribing fires immediately with the cached default (false).
    client.onAnalyticsConsent((enabled) => seen.push(enabled));
    expect(seen).toEqual([false]);

    // Drive the dispatcher the way the data channel would.
    (
      client as unknown as { handleMessage: (m: PeerMessage) => void }
    ).handleMessage({ type: "analytics-consent", enabled: true });

    expect(seen).toEqual([false, true]);
    expect(client.getAnalyticsConsent()).toBe(true);
  });
});
