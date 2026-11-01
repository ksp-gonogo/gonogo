/**
 * A station joining the main screen through the relay's endpoint: the
 * station's data connection carries its offer, the offer goes to the
 * endpoint, the answer goes back in a connection opened to the station, and
 * the station is then served over the endpoint like any other.
 */

import { ws } from "msw";
import { setupServer } from "msw/node";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { testApprovals } from "../test/approveStation";

const { FakeHub } = vi.hoisted(() => {
  class FakeDataConnection {
    private listeners = new Map<string, Array<(...args: unknown[]) => void>>();
    open = false;
    closed = false;
    constructor(
      readonly peer: string,
      readonly metadata?: unknown,
    ) {}
    on(event: string, cb: (...args: unknown[]) => void) {
      const bucket = this.listeners.get(event) ?? [];
      bucket.push(cb);
      this.listeners.set(event, bucket);
    }
    emit(event: string, ...args: unknown[]) {
      for (const cb of this.listeners.get(event) ?? []) cb(...args);
    }
    close() {
      this.closed = true;
    }
    readonly sent: unknown[] = [];
    send(m: unknown) {
      this.sent.push(m);
    }
  }

  class FakePeer {
    static current: FakePeer | null = null;
    private listeners = new Map<string, Array<(...args: unknown[]) => void>>();
    /** Connections this main screen opened to stations. */
    readonly opened: FakeDataConnection[] = [];

    constructor(readonly id: string) {
      FakePeer.current = this;
      queueMicrotask(() => this.emit("open", this.id));
    }

    on(event: string, cb: (...args: unknown[]) => void) {
      const bucket = this.listeners.get(event) ?? [];
      bucket.push(cb);
      this.listeners.set(event, bucket);
    }

    emit(event: string, ...args: unknown[]) {
      for (const cb of this.listeners.get(event) ?? []) cb(...args);
    }

    connect(id: string, options?: { metadata?: unknown }) {
      const conn = new FakeDataConnection(id, options?.metadata);
      this.opened.push(conn);
      return conn;
    }

    /** A station's data connection arriving through the broker. */
    incoming(from: string, metadata?: unknown) {
      const conn = new FakeDataConnection(from, metadata);
      this.emit("connection", conn);
      return conn;
    }

    disconnected = false;
    disconnect() {
      this.disconnected = true;
    }
    reconnect() {
      this.disconnected = false;
    }

    destroy() {}
  }
  return { FakeHub: { Peer: FakePeer } };
});

vi.mock("peerjs", () => ({ default: FakeHub.Peer }));

const store = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => store.set(k, v),
  removeItem: (k: string) => store.delete(k),
  clear: () => store.clear(),
});

import type { RelayCaller } from "@ksp-gonogo/sitrep-sdk";
import {
  registerUplinkHandle,
  unregisterUplinkHandle,
} from "@ksp-gonogo/sitrep-sdk";
import type { Packable } from "peerjs-js-binarypack";
import { encodeFrames, FrameReader } from "./endpointFraming";
import { joinMetadata, readJoin } from "./endpointJoin";
import {
  ENDPOINT_OPEN_MS,
  HOST_RECLAIM_INTERVAL_MS,
  PeerHostService,
} from "./PeerHostService";

const link = ws.link("ws://localhost:3002/stations");
const server = setupServer();
beforeAll(() => server.listen());
afterEach(() => {
  server.resetHandlers();
  store.clear();
});
afterAll(() => server.close());

/**
 * An endpoint that answers every offer and opens every station at once,
 * recording what the main screen sends each one. With `opens: false` it
 * answers and no station ever reaches it, as for a station on another
 * network with no port forwarded.
 */
function endpoint({ opens = true }: { opens?: boolean } = {}) {
  const offers: Array<{ sid: number; peerId: string; sdp: string }> = [];
  const closes: number[] = [];
  const toStation = new Map<number, unknown[]>();
  const bridges: Array<Record<string, unknown>> = [];
  let socket: { send(data: string | ArrayBuffer): void } | null = null;
  server.use(
    link.addEventListener("connection", ({ client }) => {
      socket = client;
      client.send(
        JSON.stringify({
          type: "status",
          port: 47100,
          publicIp: "203.0.113.7",
        }),
      );
      const readers = new Map<number, FrameReader>();
      client.addEventListener("message", (m) => {
        if (typeof m.data === "string") {
          const f = JSON.parse(m.data);
          if (f.type === "bridge") {
            bridges.push(f);
            client.send(
              JSON.stringify({
                type: "bridge-offer",
                bid: f.bid,
                sdp: "v=upstream-offer",
              }),
            );
            return;
          }
          if (f.type === "bridge-answer") {
            bridges.push(f);
            client.send(
              JSON.stringify({
                type: "bridge-ready",
                bid: f.bid,
                sdp: "v=station-answer",
              }),
            );
            return;
          }
          if (f.type === "close") closes.push(f.sid);
          if (f.type !== "offer") return;
          offers.push(f);
          client.send(
            JSON.stringify({
              type: "answer",
              sid: f.sid,
              sdp: `answer for ${f.peerId}`,
            }),
          );
          if (opens)
            client.send(
              JSON.stringify({ type: "open", sid: f.sid, path: "internet" }),
            );
          return;
        }
        const buf = new Uint8Array(m.data as ArrayBuffer);
        const sid = new DataView(buf.buffer, buf.byteOffset).getUint32(0);
        const reader = readers.get(sid) ?? new FrameReader();
        readers.set(sid, reader);
        const msg = reader.push(buf.slice(4));
        if (msg !== undefined)
          toStation.set(sid, [...(toStation.get(sid) ?? []), msg]);
      });
    }),
  );
  return {
    offers,
    closes,
    toStation,
    bridges,
    /** Deliver a message from a station on session `sid` to the main screen. */
    fromStation(sid: number, message: Packable) {
      for (const frame of encodeFrames(message)) {
        const out = new Uint8Array(4 + frame.byteLength);
        new DataView(out.buffer).setUint32(0, sid);
        out.set(frame, 4);
        socket?.send(out.buffer);
      }
    },
  };
}

function join(
  peer: InstanceType<typeof FakeHub.Peer>,
  from: string,
  id: string,
) {
  return peer.incoming(
    from,
    joinMetadata({ kind: "join", id, sdp: `offer from ${from}` }),
  );
}

async function startedHost(): Promise<{
  host: PeerHostService;
  peer: InstanceType<typeof FakeHub.Peer>;
}> {
  const host = new PeerHostService();
  await host.start();
  await vi.waitFor(() => expect(host.peerId).not.toBeNull());
  const peer = FakeHub.Peer.current;
  if (!peer) throw new Error("no peer");
  return { host, peer };
}

describe("a station joining through the endpoint", () => {
  it("sends the station the endpoint's answer, then serves it over the endpoint", async () => {
    const ep = endpoint();
    const { host, peer } = await startedHost();
    await vi.waitFor(() => expect(host.endpoint.available).toBe(true));

    const direct = join(peer, "station-a", "gne-1");

    await vi.waitFor(() => expect(peer.opened).toHaveLength(1));
    expect(ep.offers).toEqual([
      expect.objectContaining({
        peerId: "station-a",
        sdp: "offer from station-a",
      }),
    ]);
    expect(peer.opened[0]?.peer).toBe("station-a");
    expect(readJoin(peer.opened[0]?.metadata)).toEqual({
      kind: "answer",
      id: "gne-1",
      sdp: "answer for station-a",
    });

    const sid = ep.offers[0]?.sid ?? -1;
    await vi.waitFor(() =>
      expect(ep.toStation.get(sid)).toContainEqual(
        expect.objectContaining({ type: "hello" }),
      ),
    );
    await vi.waitFor(() =>
      expect(host.getStationPaths()).toEqual([
        expect.objectContaining({ peerId: "station-a", path: "internet" }),
      ]),
    );
    expect(direct.closed).toBe(true);
    expect(direct.sent).toEqual([]);
    host.stop();
  });

  it("serves the station's data connection, with what it already sent, when the endpoint refuses it", async () => {
    server.use(
      link.addEventListener("connection", ({ client }) => {
        client.send(JSON.stringify({ type: "status", port: 47100 }));
        client.addEventListener("message", (m) => {
          if (typeof m.data !== "string") return;
          const f = JSON.parse(m.data);
          if (f.type === "offer")
            client.send(
              JSON.stringify({ type: "close", sid: f.sid, reason: "busy" }),
            );
        });
      }),
    );
    const { host, peer } = await startedHost();
    await vi.waitFor(() => expect(host.endpoint.available).toBe(true));
    const direct = join(peer, "station-a", "gne-1");
    direct.open = true;
    direct.emit("open");
    direct.emit("data", { type: "station-credential", credential: "c" });
    await vi.waitFor(() =>
      expect(direct.sent).toContainEqual(
        expect.objectContaining({ type: "hello" }),
      ),
    );
    expect(peer.opened).toHaveLength(0);
    expect(direct.closed).toBe(false);
    host.stop();
  });

  it("serves the station's data connection when its link through the endpoint does not open in time", async () => {
    const ep = endpoint({ opens: false });
    const { host, peer } = await startedHost();
    await vi.waitFor(() => expect(host.endpoint.available).toBe(true));
    const direct = join(peer, "station-a", "gne-1");
    direct.open = true;
    direct.emit("open");
    direct.emit("data", { type: "station-credential", credential: "c" });
    await vi.waitFor(() => expect(peer.opened).toHaveLength(1));
    expect(direct.sent).toEqual([]);
    await vi.waitFor(
      () =>
        expect(direct.sent).toContainEqual(
          expect.objectContaining({ type: "hello" }),
        ),
      { timeout: ENDPOINT_OPEN_MS + 2_000 },
    );
    expect(direct.closed).toBe(false);
    expect(ep.closes).toEqual([ep.offers[0]?.sid]);
    host.stop();
  });

  it("keeps two stations joining at once apart", async () => {
    endpoint();
    const { host, peer } = await startedHost();
    await vi.waitFor(() => expect(host.endpoint.available).toBe(true));
    join(peer, "station-a", "gne-a");
    join(peer, "station-b", "gne-b");
    await vi.waitFor(() => expect(peer.opened).toHaveLength(2));
    const replies = Object.fromEntries(
      peer.opened.map((c) => [c.peer, readJoin(c.metadata)?.sdp]),
    );
    expect(replies).toEqual({
      "station-a": "answer for station-a",
      "station-b": "answer for station-b",
    });
    await vi.waitFor(() => expect(host.getStationPaths()).toHaveLength(2));
    host.stop();
  });

  it("serves the station's data connection alone when the relay is not running", async () => {
    const { host, peer } = await startedHost();
    const direct = join(peer, "station-a", "gne-1");
    await new Promise((r) => setTimeout(r, 50));
    expect(peer.opened).toHaveLength(0);
    expect(direct.closed).toBe(false);
    host.stop();
  });

  it("offers an endpoint station's Uplink calls a bridge for its media connection", async () => {
    const ep = endpoint();
    let caller: RelayCaller | undefined;
    registerUplinkHandle("camera-uplink", {
      relay: async (_method: string, args: unknown, from?: RelayCaller) => {
        caller = from;
        return from?.bridgeMedia?.(
          String(args),
          async (offer) => `sidecar answers ${offer}`,
        );
      },
    });
    const credential = "e2e0station0credential0000000000";
    testApprovals().approve(credential, "E2E");
    const { host, peer } = await startedHost();
    await vi.waitFor(() => expect(host.endpoint.available).toBe(true));
    join(peer, "station-a", "gne-1");
    await vi.waitFor(() => expect(ep.offers).toHaveLength(1));
    const sid = ep.offers[0]?.sid ?? -1;
    await vi.waitFor(() =>
      expect(ep.toStation.get(sid)?.length).toBeGreaterThan(0),
    );

    ep.fromStation(sid, { type: "station-credential", credential });
    ep.fromStation(sid, {
      type: "uplink-relay-request",
      requestId: "r1",
      uplinkId: "camera-uplink",
      method: "negotiate",
      args: "v=camera-offer",
    });

    await vi.waitFor(() =>
      expect(ep.toStation.get(sid)).toContainEqual(
        expect.objectContaining({
          type: "uplink-relay-response",
          requestId: "r1",
          result: "v=station-answer",
        }),
      ),
    );
    expect(caller?.station).toBe("station-a");
    expect(ep.bridges).toEqual([
      expect.objectContaining({ type: "bridge", sid, sdp: "v=camera-offer" }),
      expect.objectContaining({
        type: "bridge-answer",
        sdp: "sidecar answers v=upstream-offer",
      }),
    ]);
    unregisterUplinkHandle("camera-uplink");
    host.stop();
  });
});

describe("a host that freezes and resumes", () => {
  it("lets go of the endpoint when the page freezes and takes it back on resume while it hosts", async () => {
    endpoint();
    const { host, peer } = await startedHost();
    await vi.waitFor(() => expect(host.endpoint.available).toBe(true));

    document.dispatchEvent(new Event("freeze"));
    expect(host.endpoint.available).toBe(false);
    expect(peer.disconnected).toBe(true);

    document.dispatchEvent(new Event("resume"));
    await vi.waitFor(() => expect(host.endpoint.available).toBe(true));
    host.stop();
  });

  it("does not reopen the endpoint on resume once it has stopped hosting", async () => {
    endpoint();
    const { host } = await startedHost();
    await vi.waitFor(() => expect(host.endpoint.available).toBe(true));
    host.stop();
    document.dispatchEvent(new Event("resume"));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(host.endpoint.available).toBe(false);
  });
});

/** Fire `unavailable-id` on the Peer the host just opened, as the broker does for an id it still holds. */
function refuseCurrentSlot(): string {
  const peer = FakeHub.Peer.current;
  if (!peer) throw new Error("no peer");
  peer.emit("error", { type: "unavailable-id" });
  return peer.id;
}

describe("a host whose broker id is still held", () => {
  it("takes the next free slot at once, with no reclaim, when the slot its generation points at is held", async () => {
    endpoint();
    const host = new PeerHostService();
    host.shareCode = "ABC234";
    host.adoptGeneration(6);
    await host.start();
    expect(FakeHub.Peer.current?.id).toBe("gonogo-host-ABC234-2");

    expect(refuseCurrentSlot()).toBe("gonogo-host-ABC234-2");

    expect(FakeHub.Peer.current?.id).toBe("gonogo-host-ABC234-3");
    expect(host.isReclaiming()).toBe(false);
    await vi.waitFor(() => expect(host.peerId).toBe("gonogo-host-ABC234-3"));
    host.stop();
  });

  it("falls back to the reclaim interval only when all four slots are held, then walks the ring again", async () => {
    endpoint();
    const host = new PeerHostService();
    host.shareCode = "ABC234";
    host.adoptGeneration(2);
    await host.start();
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    try {
      const tried: string[] = [];
      for (let i = 0; i < 4; i++) tried.push(refuseCurrentSlot());
      expect(tried).toEqual([
        "gonogo-host-ABC234-2",
        "gonogo-host-ABC234-3",
        "gonogo-host-ABC234-0",
        "gonogo-host-ABC234-1",
      ]);
      expect(host.isReclaiming()).toBe(true);

      await vi.advanceTimersByTimeAsync(HOST_RECLAIM_INTERVAL_MS - 1);
      expect(FakeHub.Peer.current?.id).toBe("gonogo-host-ABC234-1");
      await vi.advanceTimersByTimeAsync(1);
      expect(FakeHub.Peer.current?.id).toBe("gonogo-host-ABC234-2");
    } finally {
      vi.useRealTimers();
      host.stop();
    }
  });

  it("retries at the short fixed interval and never waits longer", async () => {
    endpoint();
    const { host, peer } = await startedHost();
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    try {
      const delays: number[] = [];
      const real = globalThis.setTimeout;
      const spy = vi.spyOn(globalThis, "setTimeout").mockImplementation(((
        fn: () => void,
        ms?: number,
      ) => {
        delays.push(ms ?? 0);
        return real(fn, ms);
      }) as typeof setTimeout);
      for (let round = 0; round < 4; round++) {
        for (let slot = 0; slot < 4; slot++) refuseCurrentSlot();
        await vi.advanceTimersByTimeAsync(HOST_RECLAIM_INTERVAL_MS);
      }
      spy.mockRestore();
      const reclaims = delays.filter((d) => d >= 1_000);
      expect(reclaims.length).toBeGreaterThanOrEqual(4);
      expect(new Set(reclaims.slice(0, 4))).toEqual(
        new Set([HOST_RECLAIM_INTERVAL_MS]),
      );
      expect(peer).toBeDefined();
    } finally {
      vi.useRealTimers();
      host.stop();
    }
  });

  it("carries the generation from the role claim in its hello", async () => {
    endpoint({ opens: false });
    const host = new PeerHostService();
    host.shareCode = "ABC234";
    host.adoptGeneration(6);
    await host.start();
    await vi.waitFor(() => expect(host.peerId).not.toBeNull());

    const conn = FakeHub.Peer.current?.incoming("station-a");
    conn?.emit("open");

    expect(conn?.sent[0]).toMatchObject({ type: "hello", generation: 6 });
    host.stop();
  });

  it("asks the endpoint again after a busy refusal at the same short interval", async () => {
    const delays: number[] = [];
    const real = globalThis.setTimeout;
    const spy = vi.spyOn(globalThis, "setTimeout").mockImplementation(((
      fn: () => void,
      ms?: number,
    ) => {
      delays.push(ms ?? 0);
      return real(fn, ms);
    }) as typeof setTimeout);
    server.use(
      link.addEventListener("connection", ({ client }) => {
        client.send(JSON.stringify({ type: "busy" }));
        setTimeout(() => client.close(), 5);
      }),
    );
    const host = new PeerHostService();
    await host.start();
    await vi.waitFor(() => expect(host.endpoint.heldElsewhere).toBe(true));
    await vi.waitFor(() => expect(delays).toContain(HOST_RECLAIM_INTERVAL_MS));
    spy.mockRestore();
    host.stop();
  });
});
