import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PeerClientService } from "../peer/PeerClientService";
import { PeerHostService } from "../peer/PeerHostService";
import type { PeerMessage } from "../peer/protocol";
import { approveConnection } from "../test/approveStation";

type Listener = (...args: unknown[]) => void;

// The same fake Peer / DataConnection pair host-command-centre-peer.test.ts uses.
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

function uplinkMsgs(conn: FakeDataConnection): PeerMessage[] {
  return (conn.sent as PeerMessage[]).filter((m) => m.type === "host-uplinks");
}

const ALPHA = { id: "alpha", version: "1.0.0" };
const BETA = { id: "beta", version: "2.0.0" };

/** The Uplinks the main screen runs reach every approved station, which loads exactly that set. */
describe("host-uplinks over peer", () => {
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

  async function connect(host: PeerHostService) {
    await host.start();
    const conn = new FakeDataConnection();
    if (!FakePeer.last) throw new Error("no fake peer");
    FakePeer.last.emit("connection", conn);
    conn.emit("open");
    approveConnection(conn);
    return conn;
  }

  it("says null on connect before the host's loader has settled", async () => {
    const host = new PeerHostService();
    const conn = await connect(host);
    expect(uplinkMsgs(conn)).toEqual([{ type: "host-uplinks", uplinks: null }]);
    host.stop();
  });

  it("tells a station on connect what the host runs, and every change after", async () => {
    const host = new PeerHostService();
    host.setRunningUplinks([ALPHA]);
    const conn = await connect(host);

    host.setRunningUplinks([ALPHA]);
    host.setRunningUplinks([ALPHA, BETA]);
    expect(uplinkMsgs(conn)).toEqual([
      { type: "host-uplinks", uplinks: [ALPHA] },
      { type: "host-uplinks", uplinks: [ALPHA, BETA] },
    ]);
    host.stop();
  });

  it("a station keeps the latest set and replays it to a late subscriber", () => {
    const client = new PeerClientService();
    const early: unknown[] = [];
    client.onHostUplinksChange((set) => early.push(set));
    client["handleMessage"]({ type: "host-uplinks", uplinks: [BETA] });

    const late: unknown[] = [];
    client.onHostUplinksChange((set) => late.push(set));
    expect(early).toEqual([null, [BETA]]);
    expect(late).toEqual([[BETA]]);
  });
});
