/**
 * A station joining the main screen through the relay's endpoint: the join
 * request arrives through the broker, the offer goes to the endpoint, the
 * answer goes back to the station, and the station is then served over the
 * endpoint like any other.
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

const { FakeHub } = vi.hoisted(() => {
  /** A Peer whose broker socket is real enough to carry the join signal both ways. */
  class FakePeer {
    static current: FakePeer | null = null;
    private listeners = new Map<string, Array<(...args: unknown[]) => void>>();
    private socketListeners = new Set<(m: unknown) => void>();
    readonly toBroker: Array<{ type: string; dst: string; payload: unknown }> =
      [];
    socket = {
      on: (_e: string, cb: (m: unknown) => void) =>
        this.socketListeners.add(cb),
      off: (_e: string, cb: (m: unknown) => void) =>
        this.socketListeners.delete(cb),
      send: (m: { type: string; dst: string; payload: unknown }) =>
        this.toBroker.push(m),
    };

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

    fromBroker(m: unknown) {
      for (const cb of this.socketListeners) cb(m);
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
import { ENDPOINT_SIGNAL } from "./brokerSignal";
import { encodeFrames, FrameReader } from "./endpointFraming";
import { PeerHostService } from "./PeerHostService";

const link = ws.link("ws://localhost:3002/stations");
const server = setupServer();
beforeAll(() => server.listen());
afterEach(() => {
  server.resetHandlers();
  store.clear();
});
afterAll(() => server.close());

/** An endpoint that answers every offer and opens every station at once, recording what the main screen sends each one. */
function endpoint() {
  const offers: Array<{ sid: number; peerId: string; sdp: string }> = [];
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
          if (f.type !== "offer") return;
          offers.push(f);
          client.send(
            JSON.stringify({
              type: "answer",
              sid: f.sid,
              sdp: `answer for ${f.peerId}`,
            }),
          );
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
  connectionId: string,
) {
  peer.fromBroker({
    type: "OFFER",
    src: from,
    payload: {
      type: ENDPOINT_SIGNAL,
      connectionId,
      signal: { kind: "join", sdp: `offer from ${from}` },
    },
  });
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
  it("is told the endpoint's answer, then served over the endpoint", async () => {
    const ep = endpoint();
    const { host, peer } = await startedHost();
    await vi.waitFor(() => expect(host.endpoint.available).toBe(true));

    join(peer, "station-a", "gne-1");

    await vi.waitFor(() => expect(peer.toBroker).toHaveLength(1));
    expect(ep.offers).toEqual([
      expect.objectContaining({
        peerId: "station-a",
        sdp: "offer from station-a",
      }),
    ]);
    expect(peer.toBroker[0]).toEqual({
      type: "OFFER",
      dst: "station-a",
      payload: {
        type: ENDPOINT_SIGNAL,
        connectionId: "gne-1",
        signal: { kind: "answer", sdp: "answer for station-a" },
      },
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
    host.stop();
  });

  it("keeps two stations joining at once apart", async () => {
    endpoint();
    const { host, peer } = await startedHost();
    await vi.waitFor(() => expect(host.endpoint.available).toBe(true));
    join(peer, "station-a", "gne-a");
    join(peer, "station-b", "gne-b");
    await vi.waitFor(() => expect(peer.toBroker).toHaveLength(2));
    const replies = Object.fromEntries(
      peer.toBroker.map((m) => [
        m.dst,
        Reflect.get(Object(Reflect.get(Object(m.payload), "signal")), "sdp"),
      ]),
    );
    expect(replies).toEqual({
      "station-a": "answer for station-a",
      "station-b": "answer for station-b",
    });
    await vi.waitFor(() => expect(host.getStationPaths()).toHaveLength(2));
    host.stop();
  });

  it("is told to connect directly when the relay is not running", async () => {
    const { host, peer } = await startedHost();
    join(peer, "station-a", "gne-1");
    await vi.waitFor(() => expect(peer.toBroker).toHaveLength(1));
    expect(peer.toBroker[0]?.payload).toEqual({
      type: ENDPOINT_SIGNAL,
      connectionId: "gne-1",
      signal: { kind: "direct" },
    });
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
    store.set(
      "gonogo.host.approvedStations",
      JSON.stringify([{ credential, name: "E2E", approvedAt: 0 }]),
    );
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
