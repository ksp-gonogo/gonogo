/**
 * How a station chooses its path to the main screen: it asks through the
 * broker, then joins the endpoint with the answer it is given, or connects
 * to the main screen directly when told to or when no answer comes.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

const { Fakes } = vi.hoisted(() => {
  class FakeDataConnection {
    private listeners = new Map<string, Array<(...args: unknown[]) => void>>();
    open = false;
    on(event: string, cb: (...args: unknown[]) => void) {
      const bucket = this.listeners.get(event) ?? [];
      bucket.push(cb);
      this.listeners.set(event, bucket);
    }
    emit(event: string, ...args: unknown[]) {
      for (const cb of this.listeners.get(event) ?? []) cb(...args);
    }
    close() {}
    send() {}
  }

  class FakePeer {
    static current: FakePeer | null = null;
    private listeners = new Map<string, Array<(...args: unknown[]) => void>>();
    private socketListeners = new Set<(m: unknown) => void>();
    readonly toBroker: Array<{ type: string; dst: string; payload: unknown }> =
      [];
    connectedTo: string | null = null;
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
    connect(id: string) {
      this.connectedTo = id;
      return new FakeDataConnection();
    }
    destroy() {}
  }
  return { Fakes: { Peer: FakePeer } };
});

vi.mock("peerjs", () => ({ default: Fakes.Peer }));

/** Enough RTCPeerConnection for the station's endpoint link: it records the answer and opens its channel on demand. */
class FakeRTCPeerConnection {
  static last: FakeRTCPeerConnection | null = null;
  readonly channel = Object.assign(new EventTarget(), {
    binaryType: "blob",
    sent: [] as Uint8Array[],
    send(f: Uint8Array) {
      this.sent.push(f);
    },
    close() {},
  });
  localDescription: RTCSessionDescriptionInit | null = null;
  remote: RTCSessionDescriptionInit | null = null;
  iceConnectionState = "new";
  constructor() {
    FakeRTCPeerConnection.last = this;
  }
  createDataChannel() {
    return this.channel;
  }
  async createOffer() {
    return { type: "offer", sdp: "v=station-offer" };
  }
  async setLocalDescription(d: RTCSessionDescriptionInit) {
    this.localDescription = d;
  }
  async setRemoteDescription(d: RTCSessionDescriptionInit) {
    this.remote = d;
  }
  addEventListener() {}
  close() {}
}

import { ENDPOINT_SIGNAL } from "./brokerSignal";
import { FrameReader } from "./endpointFraming";
import { PeerClientService } from "./PeerClientService";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

async function asked(): Promise<{
  svc: PeerClientService;
  peer: InstanceType<typeof Fakes.Peer>;
  connectionId: string;
}> {
  vi.stubGlobal("RTCPeerConnection", FakeRTCPeerConnection);
  const svc = new PeerClientService({ peerId: "station-test" });
  svc.connect("ABCD");
  await vi.waitFor(() => expect(Fakes.Peer.current?.toBroker).toHaveLength(1));
  const peer = Fakes.Peer.current;
  if (!peer) throw new Error("no peer");
  const sent = peer.toBroker[0] as {
    dst: string;
    payload: { type: string; connectionId: string; signal: unknown };
  };
  expect(sent.dst).toBe("gonogo-host-ABCD");
  expect(sent.payload.type).toBe(ENDPOINT_SIGNAL);
  expect(sent.payload.signal).toEqual({ kind: "join", sdp: "v=station-offer" });
  return { svc, peer, connectionId: sent.payload.connectionId };
}

function reply(
  peer: InstanceType<typeof Fakes.Peer>,
  connectionId: string,
  signal: unknown,
) {
  peer.fromBroker({
    type: "OFFER",
    src: "gonogo-host-ABCD",
    payload: { type: ENDPOINT_SIGNAL, connectionId, signal },
  });
}

describe("a station choosing its path to the main screen", () => {
  it("joins through the endpoint with the answer the main screen relays", async () => {
    const { svc, peer, connectionId } = await asked();
    reply(peer, connectionId, { kind: "answer", sdp: "v=endpoint-answer" });
    const pc = FakeRTCPeerConnection.last;
    await vi.waitFor(() =>
      expect(pc?.remote).toEqual({ type: "answer", sdp: "v=endpoint-answer" }),
    );
    pc?.channel.dispatchEvent(new Event("open"));
    expect(svc.getConnStatus()).toBe("connected");
    expect(peer.connectedTo).toBeNull();
    const first = new FrameReader().push(pc?.channel.sent[0] as Uint8Array);
    expect(first).toMatchObject({ type: "station-credential" });
    svc.disconnect();
  });

  it("connects directly when the main screen says no endpoint is running", async () => {
    const { svc, peer, connectionId } = await asked();
    reply(peer, connectionId, { kind: "direct" });
    expect(peer.connectedTo).toBe("gonogo-host-ABCD");
    svc.disconnect();
  });

  it("ignores a reply meant for another join", async () => {
    const { svc, peer } = await asked();
    reply(peer, "gne-someone-else", { kind: "direct" });
    expect(peer.connectedTo).toBeNull();
    svc.disconnect();
  });

  it("connects directly when the main screen does not answer", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { svc, peer } = await asked();
    await vi.advanceTimersByTimeAsync(4_000);
    expect(peer.connectedTo).toBe("gonogo-host-ABCD");
    svc.disconnect();
  });
});
