/**
 * A station that joined through the relay's endpoint, with the main screen's
 * tab closed for 30 seconds and then reopened. The real main screen service
 * and the real station service run against a stand-in broker and an endpoint
 * served over a mock socket. The station's link to the endpoint goes quiet
 * rather than closing, as it does when the main screen's tab vanishes.
 */

import { ws } from "msw";
import { setupServer } from "msw/node";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

const { Broker } = vi.hoisted(() => {
  type Listener = (...args: unknown[]) => void;

  class Emitter {
    private listeners = new Map<string, Listener[]>();
    on(event: string, cb: Listener) {
      const bucket = this.listeners.get(event) ?? [];
      bucket.push(cb);
      this.listeners.set(event, bucket);
    }
    emit(event: string, ...args: unknown[]) {
      for (const cb of this.listeners.get(event) ?? []) cb(...args);
    }
  }

  class Conn extends Emitter {
    open = false;
    closed = false;
    other: Conn | null = null;
    constructor(
      readonly peer: string,
      readonly metadata?: unknown,
    ) {
      super();
    }
    send(message: unknown) {
      const other = this.other;
      if (!other || other.closed) return;
      queueMicrotask(() => other.emit("data", message));
    }
    close() {
      if (this.closed) return;
      this.closed = true;
      this.open = false;
      this.emit("close");
      const other = this.other;
      if (other && !other.closed) {
        other.closed = true;
        other.open = false;
        other.emit("close");
      }
    }
  }

  class BrokerPeer extends Emitter {
    static registry = new Map<string, BrokerPeer>();
    destroyed = false;
    constructor(readonly id: string) {
      super();
      BrokerPeer.registry.set(id, this);
      queueMicrotask(() => this.emit("open", id));
    }
    connect(id: string, options?: { metadata?: unknown }) {
      const mine = new Conn(id, options?.metadata);
      const target = BrokerPeer.registry.get(id);
      if (!target) {
        queueMicrotask(() =>
          this.emit(
            "error",
            Object.assign(new Error(`Could not connect to peer ${id}`), {
              type: "peer-unavailable",
            }),
          ),
        );
        return mine;
      }
      const theirs = new Conn(this.id, options?.metadata);
      mine.other = theirs;
      theirs.other = mine;
      queueMicrotask(() => {
        target.emit("connection", theirs);
        mine.open = theirs.open = true;
        mine.emit("open");
        theirs.emit("open");
      });
      return mine;
    }
    /** A tab that vanishes: the broker slot frees and no connection reports a close. */
    destroy() {
      this.destroyed = true;
      if (BrokerPeer.registry.get(this.id) === this) {
        BrokerPeer.registry.delete(this.id);
      }
    }
    disconnect() {}
  }

  return { Broker: BrokerPeer };
});

vi.mock("peerjs", () => ({ default: Broker }));

const store = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => store.set(k, v),
  removeItem: (k: string) => store.delete(k),
  clear: () => store.clear(),
});

/** The station's side of the endpoint: one data channel per offer, wired to the mock socket below. */
const stationLinks = vi.hoisted(() => ({
  byOffer: new Map<string, { sdp: string; sid: number; closed: boolean }>(),
  count: 0,
  /** Zero opens the station's channel first; above zero the endpoint reports the station open and the channel opens this long after. */
  openLagMs: 0,
  onSend: (_conn: { sid: number }, _frame: Uint8Array) => {},
  onOpened: (_conn: { sid: number }) => {},
}));

class FakeStationConnection {
  readonly channel = Object.assign(new EventTarget(), {
    binaryType: "blob",
    send: (frame: Uint8Array) => stationLinks.onSend(this, frame),
    close() {},
  });
  iceConnectionState = "connected";
  sdp = "";
  sid = -1;
  closed = false;
  async createOffer() {
    this.sdp = `v=station-offer-${stationLinks.count++}`;
    stationLinks.byOffer.set(this.sdp, this);
    return { type: "offer", sdp: this.sdp };
  }
  createDataChannel() {
    return this.channel;
  }
  async setLocalDescription() {}
  /** The channel opens once the endpoint's answer is applied, and the endpoint reports it open after that. */
  async setRemoteDescription() {
    const lag = stationLinks.openLagMs;
    if (lag > 0) stationLinks.onOpened(this);
    setTimeout(() => {
      this.channel.dispatchEvent(new Event("open"));
      if (lag === 0) stationLinks.onOpened(this);
    }, lag);
  }
  addEventListener() {}
  close() {
    this.closed = true;
  }
}

import { PeerClientService } from "./PeerClientService";
import { PeerHostService } from "./PeerHostService";

const link = ws.link("ws://localhost:3002/stations");
const server = setupServer();

/** The mock socket the live main screen holds; a station frame goes out through it. */
let socket: { send(data: string | ArrayBuffer): void } | null = null;
const bySid = new Map<number, FakeStationConnection>();

stationLinks.onSend = (conn, frame) => {
  const out = new Uint8Array(4 + frame.byteLength);
  new DataView(out.buffer).setUint32(0, conn.sid);
  out.set(frame, 4);
  socket?.send(out.buffer);
};

function serveEndpoint() {
  stationLinks.onOpened = (station) => {
    socket?.send(
      JSON.stringify({ type: "open", sid: station.sid, path: "internet" }),
    );
  };
  server.use(
    link.addEventListener("connection", ({ client }) => {
      socket = client;
      bySid.clear();
      client.send(
        JSON.stringify({
          type: "status",
          port: 47100,
          publicIp: "203.0.113.7",
        }),
      );
      client.addEventListener("message", (m) => {
        if (typeof m.data === "string") {
          const f = JSON.parse(m.data);
          if (f.type !== "offer") return;
          const station = stationLinks.byOffer.get(f.sdp) as
            | FakeStationConnection
            | undefined;
          if (!station) return;
          station.sid = f.sid;
          bySid.set(f.sid, station);
          client.send(
            JSON.stringify({ type: "answer", sid: f.sid, sdp: "v=answer" }),
          );
          return;
        }
        const buf = new Uint8Array(m.data as ArrayBuffer);
        const sid = new DataView(buf.buffer, buf.byteOffset).getUint32(0);
        const station = bySid.get(sid);
        if (!station || station.closed) return;
        station.channel.dispatchEvent(
          new MessageEvent("message", { data: buf.slice(4).buffer }),
        );
      });
    }),
  );
}

beforeAll(() => server.listen());
beforeEach(() => {
  vi.stubGlobal("RTCPeerConnection", FakeStationConnection);
  vi.useFakeTimers({
    toFake: [
      "setTimeout",
      "clearTimeout",
      "setInterval",
      "clearInterval",
      "Date",
    ],
  });
});
afterEach(() => {
  stationLinks.openLagMs = 0;
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => store.set(k, v),
    removeItem: (k: string) => store.delete(k),
    clear: () => store.clear(),
  });
  server.resetHandlers();
  store.clear();
  Broker.registry.clear();
  stationLinks.byOffer.clear();
  socket = null;
});
afterAll(() => server.close());

const realSetTimeout = globalThis.setTimeout;

/** Advances the fake clock, then lets the mock socket's real I/O run, which the fake clock does not drive. */
async function settle(ms: number) {
  await vi.advanceTimersByTimeAsync(ms);
  await new Promise<void>((resolve) => realSetTimeout(resolve, 2));
}

async function until(check: () => boolean, budgetMs = 60_000) {
  for (let spent = 0; spent < budgetMs && !check(); spent += 250) {
    await settle(250);
  }
  expect(check()).toBe(true);
}

describe("a station on the endpoint when the main screen's tab is closed for 30 seconds", () => {
  it("rejoins through the endpoint once the main screen is back", async () => {
    serveEndpoint();
    const host = new PeerHostService();
    await host.start();
    await vi.waitFor(() => expect(host.endpoint.available).toBe(true));

    const station = new PeerClientService({ peerId: "station-rejoin" });
    station.connect(host.shareCode);
    await until(() => station.getConnStatus() === "connected");
    await until(() => host.getStationPaths().length === 1);
    expect(host.getStationPaths()[0]).toMatchObject({ path: "internet" });

    host.stop();
    socket = null;
    await settle(30_000);
    expect(station.getConnStatus()).not.toBe("connected");

    const reopened = new PeerHostService();
    await reopened.start();
    await until(() => reopened.endpoint.available);
    await until(() => station.getConnStatus() === "connected", 120_000);
    await until(() => reopened.getStationPaths().length === 1);
    expect(reopened.getStationPaths()[0]).toMatchObject({ path: "internet" });

    station.disconnect();
    reopened.stop();
  });

  it("rejoins when the endpoint reports it open before its own channel does", async () => {
    stationLinks.openLagMs = 50;
    serveEndpoint();
    const host = new PeerHostService();
    await host.start();
    await vi.waitFor(() => expect(host.endpoint.available).toBe(true));

    const station = new PeerClientService({ peerId: "station-rejoin" });
    station.connect(host.shareCode);
    await until(() => station.getConnStatus() === "connected");
    await until(() => host.getStationPaths().length === 1);
    expect(host.getStationPaths()[0]).toMatchObject({ path: "internet" });

    station.disconnect();
    host.stop();
  });
});
