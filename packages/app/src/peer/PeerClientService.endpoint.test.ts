/**
 * How a station chooses its path to the main screen: its data connection
 * carries an offer for the endpoint, and it joins through the endpoint when
 * the main screen answers that offer and the link opens, or stays on the
 * data connection when the main screen serves it instead.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

const { Fakes } = vi.hoisted(() => {
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
    send() {}
  }

  class FakePeer {
    static current: FakePeer | null = null;
    private listeners = new Map<string, Array<(...args: unknown[]) => void>>();
    readonly connections: FakeDataConnection[] = [];
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
      this.connections.push(conn);
      return conn;
    }
    /** The main screen opening a connection to this station. */
    incoming(metadata: unknown) {
      const conn = new FakeDataConnection("gonogo-host-ABCD", metadata);
      this.emit("connection", conn);
      return conn;
    }
    destroy() {}
  }
  return { Fakes: { Peer: FakePeer, DataConnection: FakeDataConnection } };
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
  closed = false;
  close() {
    this.closed = true;
  }
}

import { FrameReader } from "./endpointFraming";
import { joinMetadata, readJoin } from "./endpointJoin";
import { PeerClientService } from "./PeerClientService";

afterEach(() => {
  vi.unstubAllGlobals();
});

type FakeConn = InstanceType<typeof Fakes.DataConnection>;

async function joining(): Promise<{
  svc: PeerClientService;
  peer: InstanceType<typeof Fakes.Peer>;
  direct: FakeConn;
  id: string;
}> {
  vi.stubGlobal("RTCPeerConnection", FakeRTCPeerConnection);
  const svc = new PeerClientService({ peerId: "station-test" });
  svc.connect("ABCD");
  await vi.waitFor(() =>
    expect(Fakes.Peer.current?.connections).toHaveLength(1),
  );
  const peer = Fakes.Peer.current;
  if (!peer) throw new Error("no peer");
  const direct = peer.connections[0];
  expect(direct.peer).toBe("gonogo-host-ABCD");
  const join = readJoin(direct.metadata);
  expect(join).toMatchObject({ kind: "join", sdp: "v=station-offer" });
  return { svc, peer, direct, id: join?.id ?? "" };
}

describe("a station choosing its path to the main screen", () => {
  it("joins through the endpoint with the answer the main screen sends back", async () => {
    const { svc, peer, direct, id } = await joining();
    const carrier = peer.incoming(
      joinMetadata({ kind: "answer", id, sdp: "v=endpoint-answer" }),
    );
    expect(carrier.closed).toBe(false);
    carrier.emit("open");
    expect(carrier.closed).toBe(true);
    const pc = FakeRTCPeerConnection.last;
    await vi.waitFor(() =>
      expect(pc?.remote).toEqual({ type: "answer", sdp: "v=endpoint-answer" }),
    );
    expect(direct.closed).toBe(false);
    pc?.channel.dispatchEvent(new Event("open"));
    expect(direct.closed).toBe(true);
    expect(svc.getConnStatus()).toBe("connected");
    const first = new FrameReader().push(pc?.channel.sent[0] as Uint8Array);
    expect(first).toMatchObject({ type: "station-credential" });
    svc.disconnect();
  });

  it("joins through the endpoint even when its data connection opened first", async () => {
    const { peer, direct, id } = await joining();
    direct.open = true;
    direct.emit("open");
    peer.incoming(joinMetadata({ kind: "answer", id, sdp: "v=endpoint" }));
    const pc = FakeRTCPeerConnection.last;
    await vi.waitFor(() => expect(pc?.remote?.sdp).toBe("v=endpoint"));
    pc?.channel.dispatchEvent(new Event("open"));
    expect(direct.closed).toBe(true);
    const first = new FrameReader().push(pc?.channel.sent[0] as Uint8Array);
    expect(first).toMatchObject({ type: "station-credential" });
  });

  it("stays on its data connection when the endpoint answers but its link never opens", async () => {
    const { svc, peer, direct, id } = await joining();
    direct.open = true;
    direct.emit("open");
    expect(svc.getConnStatus()).not.toBe("connected");
    peer.incoming(joinMetadata({ kind: "answer", id, sdp: "v=unreachable" }));
    const pc = FakeRTCPeerConnection.last;
    await vi.waitFor(() => expect(pc?.remote?.sdp).toBe("v=unreachable"));
    direct.emit("data", { type: "host-heartbeat" });
    expect(pc?.closed).toBe(true);
    expect(direct.closed).toBe(false);
    expect(svc.getConnStatus()).toBe("connected");
    svc.disconnect();
  });

  it("stays on its data connection once the main screen serves it", async () => {
    const { svc, peer, direct, id } = await joining();
    direct.open = true;
    direct.emit("open");
    direct.emit("data", { type: "host-heartbeat" });
    expect(svc.getConnStatus()).toBe("connected");
    peer.incoming(joinMetadata({ kind: "answer", id, sdp: "v=late" }));
    expect(FakeRTCPeerConnection.last?.remote).toBeNull();
    expect(direct.closed).toBe(false);
    svc.disconnect();
  });

  it("ignores an answer meant for another join", async () => {
    const { svc, peer, direct } = await joining();
    peer.incoming(
      joinMetadata({ kind: "answer", id: "gne-someone-else", sdp: "v=0" }),
    );
    expect(FakeRTCPeerConnection.last?.remote).toBeNull();
    expect(direct.closed).toBe(false);
    svc.disconnect();
  });

  it("connects with no offer when the browser cannot make one", async () => {
    vi.stubGlobal("RTCPeerConnection", undefined);
    const svc = new PeerClientService({ peerId: "station-test" });
    svc.connect("ABCD");
    await vi.waitFor(() =>
      expect(Fakes.Peer.current?.connections).toHaveLength(1),
    );
    expect(Fakes.Peer.current?.connections[0].metadata).toBeUndefined();
    svc.disconnect();
  });
});
