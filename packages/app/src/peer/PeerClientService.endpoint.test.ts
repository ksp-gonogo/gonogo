/**
 * How a station chooses its path to the main screen: each data connection to
 * a slot of the host's id ring carries an offer for the endpoint, and it joins
 * through the endpoint when the main screen answers that offer and the link
 * carries its hello, or stays on the data connection when the main screen
 * serves it instead.
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
      const conn = new FakeDataConnection("gonogo-host-ABCD-0", metadata);
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
  static all: FakeRTCPeerConnection[] = [];
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
    FakeRTCPeerConnection.all.push(this);
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

import { encodeFrames, FrameReader } from "./endpointFraming";
import { joinMetadata, readJoin } from "./endpointJoin";
import { PeerClientService } from "./PeerClientService";
import { asPeerMessage } from "./protocol";

afterEach(() => {
  vi.unstubAllGlobals();
  FakeRTCPeerConnection.all = [];
});

const HELLO = {
  type: "hello",
  version: "1",
  buildTime: "t",
  sessionToken: "s",
  generation: 1,
};

/** The main screen's hello arriving over an endpoint link. */
function helloOver(
  pc: FakeRTCPeerConnection | undefined,
  generation = HELLO.generation,
): void {
  for (const frame of encodeFrames({ ...HELLO, generation })) {
    pc?.channel.dispatchEvent(
      Object.assign(new Event("message"), { data: frame.buffer }),
    );
  }
}

type FakeConn = InstanceType<typeof Fakes.DataConnection>;

async function joining(): Promise<{
  svc: PeerClientService;
  peer: InstanceType<typeof Fakes.Peer>;
  direct: FakeConn;
  pc: FakeRTCPeerConnection;
  id: string;
}> {
  vi.stubGlobal("RTCPeerConnection", FakeRTCPeerConnection);
  const svc = new PeerClientService({ peerId: "station-test" });
  svc.connect("ABCD");
  await vi.waitFor(() =>
    expect(Fakes.Peer.current?.connections).toHaveLength(4),
  );
  const peer = Fakes.Peer.current;
  if (!peer) throw new Error("no peer");
  const direct = peer.connections[0];
  expect(direct.peer).toBe("gonogo-host-ABCD-0");
  const join = readJoin(direct.metadata);
  expect(join).toMatchObject({ kind: "join", sdp: "v=station-offer" });
  return {
    svc,
    peer,
    direct,
    pc: FakeRTCPeerConnection.all[0],
    id: join?.id ?? "",
  };
}

describe("a station choosing its path to the main screen", () => {
  it("joins through the endpoint with the answer the main screen sends back", async () => {
    const { svc, peer, direct, pc, id } = await joining();
    const carrier = peer.incoming(
      joinMetadata({ kind: "answer", id, sdp: "v=endpoint-answer" }),
    );
    expect(carrier.closed).toBe(false);
    carrier.emit("open");
    expect(carrier.closed).toBe(true);
    await vi.waitFor(() =>
      expect(pc.remote).toEqual({ type: "answer", sdp: "v=endpoint-answer" }),
    );
    expect(direct.closed).toBe(false);
    pc.channel.dispatchEvent(new Event("open"));
    helloOver(pc);
    expect(direct.closed).toBe(true);
    expect(svc.getConnStatus()).toBe("connected");
    const first = new FrameReader().push(pc.channel.sent[0] as Uint8Array);
    expect(first).toMatchObject({ type: "station-credential" });
    svc.disconnect();
  });

  it("joins through the endpoint even when its data connection opened first", async () => {
    const { peer, direct, pc, id } = await joining();
    direct.open = true;
    direct.emit("open");
    peer.incoming(joinMetadata({ kind: "answer", id, sdp: "v=endpoint" }));
    await vi.waitFor(() => expect(pc.remote?.sdp).toBe("v=endpoint"));
    pc.channel.dispatchEvent(new Event("open"));
    helloOver(pc);
    expect(direct.closed).toBe(true);
    const first = new FrameReader().push(pc.channel.sent[0] as Uint8Array);
    expect(first).toMatchObject({ type: "station-credential" });
  });

  it("keeps exactly one link through the endpoint when two hosts answer, the one with the higher generation", async () => {
    const { svc, peer, direct, pc: pcOlder } = await joining();
    const newerOffer = readJoin(peer.connections[1].metadata);
    const pcNewer = FakeRTCPeerConnection.all[1];
    peer.incoming(
      joinMetadata({
        kind: "answer",
        id: readJoin(direct.metadata)?.id ?? "",
        sdp: "v=older",
      }),
    );
    peer.incoming(
      joinMetadata({
        kind: "answer",
        id: newerOffer?.id ?? "",
        sdp: "v=newer",
      }),
    );
    await vi.waitFor(() => expect(pcNewer.remote?.sdp).toBe("v=newer"));
    pcOlder.channel.dispatchEvent(new Event("open"));
    pcNewer.channel.dispatchEvent(new Event("open"));

    helloOver(pcOlder);
    helloOver(pcNewer, 2);

    expect(pcOlder.closed).toBe(true);
    expect(pcNewer.closed).toBe(false);
    const credential = (pc: FakeRTCPeerConnection) =>
      pc.channel.sent.filter(
        (f) =>
          asPeerMessage(new FrameReader().push(f))?.type ===
          "station-credential",
      );
    expect(credential(pcOlder)).toHaveLength(1);
    expect(credential(pcNewer)).toHaveLength(1);
    svc.disconnect();
  });

  it("stays on its data connection when the endpoint answers but its link never opens", async () => {
    const { svc, peer, direct, pc, id } = await joining();
    direct.open = true;
    direct.emit("open");
    expect(svc.getConnStatus()).not.toBe("connected");
    peer.incoming(joinMetadata({ kind: "answer", id, sdp: "v=unreachable" }));
    await vi.waitFor(() => expect(pc.remote?.sdp).toBe("v=unreachable"));
    direct.emit("data", { type: "host-heartbeat" });
    expect(pc.closed).toBe(true);
    expect(direct.closed).toBe(false);
    expect(svc.getConnStatus()).toBe("connected");
    svc.disconnect();
  });

  it("stays on its data connection once the main screen serves it", async () => {
    const { svc, peer, direct, pc, id } = await joining();
    direct.open = true;
    direct.emit("open");
    direct.emit("data", { type: "host-heartbeat" });
    expect(svc.getConnStatus()).toBe("connected");
    peer.incoming(joinMetadata({ kind: "answer", id, sdp: "v=late" }));
    expect(pc.remote).toBeNull();
    expect(direct.closed).toBe(false);
    svc.disconnect();
  });

  it("ignores an answer meant for another join", async () => {
    const { svc, peer, direct } = await joining();
    peer.incoming(
      joinMetadata({ kind: "answer", id: "gne-someone-else", sdp: "v=0" }),
    );
    expect(FakeRTCPeerConnection.all.every((pc) => pc.remote === null)).toBe(
      true,
    );
    expect(direct.closed).toBe(false);
    svc.disconnect();
  });

  it("connects with no offer when the browser cannot make one", async () => {
    vi.stubGlobal("RTCPeerConnection", undefined);
    const svc = new PeerClientService({ peerId: "station-test" });
    svc.connect("ABCD");
    await vi.waitFor(() =>
      expect(Fakes.Peer.current?.connections).toHaveLength(4),
    );
    expect(
      Fakes.Peer.current?.connections.every((c) => c.metadata === undefined),
    ).toBe(true);
    svc.disconnect();
  });
});
