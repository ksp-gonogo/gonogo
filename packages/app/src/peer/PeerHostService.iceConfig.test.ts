/**
 * Which ICE servers the host's Peer carries, before and after one slow
 * station makes it add the relay.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

const { FakeHub } = vi.hoisted(() => {
  class FakeDataConnection {
    private listeners = new Map<string, Array<(...args: unknown[]) => void>>();
    open = false;
    constructor(public peer: string) {}
    on(event: string, cb: (...args: unknown[]) => void) {
      const bucket = this.listeners.get(event) ?? [];
      bucket.push(cb);
      this.listeners.set(event, bucket);
    }
    send(_msg?: unknown) {}
    close() {}
  }

  class FakePeer {
    static instances: FakePeer[] = [];
    private listeners = new Map<string, Array<(...args: unknown[]) => void>>();
    id: string;
    _options: { config?: { iceServers: RTCIceServer[] } };

    constructor(
      id: string,
      options: { config?: { iceServers: RTCIceServer[] } },
    ) {
      this.id = id;
      this._options = { config: options.config };
      FakePeer.instances.push(this);
      queueMicrotask(() => this.emit("open", id));
    }
    on(event: string, cb: (...args: unknown[]) => void) {
      const bucket = this.listeners.get(event) ?? [];
      bucket.push(cb);
      this.listeners.set(event, bucket);
    }
    emit(event: string, ...args: unknown[]) {
      for (const cb of this.listeners.get(event) ?? []) cb(...args);
    }
    destroy() {}
  }

  return { FakeHub: { Peer: FakePeer, Conn: FakeDataConnection } };
});

vi.mock("peerjs", () => ({ default: FakeHub.Peer }));

const store = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
  clear: () => store.clear(),
});

import { STUN_SERVERS } from "./iceServers";
import { PeerHostService } from "./PeerHostService";

const TURN: RTCIceServer[] = [
  {
    urls: ["turn:relay.example.com:3478"],
    username: "u",
    credential: "c",
  },
];

describe("the host's ICE servers", () => {
  afterEach(() => {
    vi.useRealTimers();
    FakeHub.Peer.instances = [];
    store.clear();
  });

  it("start on the STUN list alone", async () => {
    const host = new PeerHostService();
    await host.start();
    expect(FakeHub.Peer.instances[0]._options.config?.iceServers).toEqual(
      STUN_SERVERS,
    );
    host.stop();
  });

  it("keep STUN for a later station once a slow one has escalated to the relay", async () => {
    vi.useFakeTimers();
    const host = new PeerHostService();
    await host.start();
    host.iceServers = TURN;
    const peer = FakeHub.Peer.instances[0];

    peer.emit("connection", new FakeHub.Conn("station-slow"));
    await vi.advanceTimersByTimeAsync(6_000);

    const servers = peer._options.config?.iceServers ?? [];
    expect(servers).toEqual([...STUN_SERVERS, ...TURN]);
    host.stop();
  });
});
