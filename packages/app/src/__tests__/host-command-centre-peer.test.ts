import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PeerClientService } from "../peer/PeerClientService";
import { PeerHostService } from "../peer/PeerHostService";
import type { PeerMessage } from "../peer/protocol";

type Listener = (...args: unknown[]) => void;

// The same fake Peer / DataConnection pair analytics-consent-peer.test.ts uses.
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

function centreMsgs(conn: FakeDataConnection): PeerMessage[] {
  return (conn.sent as PeerMessage[]).filter(
    (m) => m.type === "host-command-centre",
  );
}

/**
 * Where the main screen stands reaches a pilot over the peer link, since a
 * pilot's own session is aboard and nothing on its wire names mission
 * control's centre.
 */
describe("host-command-centre over peer", () => {
  beforeEach(() => {
    FakePeer.last = null;
    localStorage.clear();
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new Error("no network in test"))),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  async function connected() {
    const host = new PeerHostService();
    await host.start();
    const conn = new FakeDataConnection();
    if (!FakePeer.last) throw new Error("no fake peer");
    FakePeer.last.emit("connection", conn);
    conn.emit("open");
    return { host, conn };
  }

  it("tells a peer on connect where the host stands, and every move after", async () => {
    const host = new PeerHostService();
    host.setCommandCentre("ground:KSC");
    await host.start();
    const conn = new FakeDataConnection();
    if (!FakePeer.last) throw new Error("no fake peer");
    FakePeer.last.emit("connection", conn);
    conn.emit("open");
    expect(centreMsgs(conn)).toEqual([
      { type: "host-command-centre", centreId: "ground:KSC" },
    ]);

    host.setCommandCentre("ground:gs1");
    host.setCommandCentre("ground:gs1");
    expect(centreMsgs(conn)).toEqual([
      { type: "host-command-centre", centreId: "ground:KSC" },
      { type: "host-command-centre", centreId: "ground:gs1" },
    ]);
    host.stop();
  });

  it("says null before the host has been placed anywhere", async () => {
    const { host, conn } = await connected();
    expect(centreMsgs(conn)).toEqual([
      { type: "host-command-centre", centreId: null },
    ]);
    host.stop();
  });

  it("a peer keeps the latest centre and replays it to a late subscriber", () => {
    const client = new PeerClientService();
    expect(client.getHostCommandCentre()).toBeNull();

    (
      client as unknown as { handleMessage: (m: PeerMessage) => void }
    ).handleMessage({ type: "host-command-centre", centreId: "ground:gs1" });

    const seen: (string | null)[] = [];
    client.onHostCommandCentreChange((c) => seen.push(c));
    expect(seen).toEqual(["ground:gs1"]);
    expect(client.getHostCommandCentre()).toBe("ground:gs1");
  });
});
