import { afterEach, describe, expect, it, vi } from "vitest";
import { HostJobs } from "../hosting/HostJobs";

const { FakeHub } = vi.hoisted(() => {
  /** Enough RTCPeerConnection for `attachIceDiagnostics` to watch. */
  class FakePeerConnection {
    iceConnectionState: RTCIceConnectionState = "connected";
    iceGatheringState: RTCIceGatheringState = "complete";
    connectionState: RTCPeerConnectionState = "connected";
    signalingState: RTCSignalingState = "stable";
    private listeners = new Map<string, Array<() => void>>();

    addEventListener(event: string, cb: () => void) {
      const bucket = this.listeners.get(event) ?? [];
      bucket.push(cb);
      this.listeners.set(event, bucket);
    }

    /** The silent death: ICE goes terminal and PeerJS says nothing. */
    fail() {
      this.iceConnectionState = "failed";
      for (const cb of this.listeners.get("iceconnectionstatechange") ?? [])
        cb();
    }
  }

  class FakeDataConnection {
    private listeners = new Map<string, Array<(...args: unknown[]) => void>>();
    peer: string;
    open = true;
    peerConnection: FakePeerConnection | undefined;

    constructor(peer: string, withPeerConnection: boolean) {
      this.peer = peer;
      this.peerConnection = withPeerConnection
        ? new FakePeerConnection()
        : undefined;
    }

    on(event: string, cb: (...args: unknown[]) => void) {
      const bucket = this.listeners.get(event) ?? [];
      bucket.push(cb);
      this.listeners.set(event, bucket);
    }

    emit(event: string, ...args: unknown[]) {
      for (const cb of this.listeners.get(event) ?? []) cb(...args);
    }

    readonly sent: unknown[] = [];

    send(message?: unknown) {
      this.sent.push(message);
    }

    close() {
      this.open = false;
      this.emit("close");
    }
  }

  class FakePeer {
    static registry = new Map<string, FakePeer>();
    private listeners = new Map<string, Array<(...args: unknown[]) => void>>();
    id: string;

    constructor(id?: string) {
      this.id = id ?? `peer-${Math.random().toString(36).slice(2, 10)}`;
      FakePeer.registry.set(this.id, this);
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

    destroy() {}
  }

  return {
    FakeHub: {
      Peer: FakePeer,
      DataConnection: FakeDataConnection,
      reset() {
        FakePeer.registry.clear();
      },
    },
  };
});

vi.mock("peerjs", () => ({ default: FakeHub.Peer }));

const localStorageMock = {
  store: new Map<string, string>(),
  getItem(k: string) {
    return this.store.get(k) ?? null;
  },
  setItem(k: string, v: string) {
    this.store.set(k, v);
  },
  removeItem(k: string) {
    this.store.delete(k);
  },
  clear() {
    this.store.clear();
  },
};
vi.stubGlobal("localStorage", localStorageMock);

import { setActiveTelemetryClientForTests } from "@ksp-gonogo/sitrep-client";
import { FaultCode } from "@ksp-gonogo/sitrep-sdk";
import { approveConnection } from "../test/approveStation";
import { PeerHostService } from "./PeerHostService";

type FakeConn = InstanceType<typeof FakeHub.DataConnection>;

async function connectStation(
  host: PeerHostService,
  peerId: string,
  credential: string,
): Promise<FakeConn> {
  const peer = FakeHub.Peer.registry.get(host.peerId ?? "");
  if (!peer) throw new Error("host peer not registered");
  const conn = new FakeHub.DataConnection(peerId, true);
  peer.emit("connection", conn);
  conn.emit("open");
  await Promise.resolve();
  approveConnection(conn, credential);
  await Promise.resolve();
  conn.sent.length = 0;
  return conn;
}

async function startedHost(): Promise<PeerHostService> {
  const host = new PeerHostService();
  await host.start();
  await Promise.resolve();
  return host;
}

/** A host client whose command results the test settles by hand. */
function controllableClient() {
  const settle = new Map<
    string,
    { resolve: (v: unknown) => void; reject: (e: unknown) => void }
  >();
  setActiveTelemetryClientForTests({
    dispatch: (
      _command: string,
      _args: unknown,
      _label: string,
      _topic: string,
      _vantage: string | undefined,
      requestId?: string,
    ) => {
      const id = requestId ?? "c1";
      const result = new Promise<unknown>((resolve, reject) => {
        settle.set(id, { resolve, reject });
      });
      return { requestId: id, result };
    },
    onRawMessage: () => () => {},
  } as never);
  return settle;
}

function send(conn: FakeConn, requestId: string): void {
  conn.emit("data", {
    type: "sitrep-command-request",
    requestId,
    command: "vessel.control.throttle",
    label: "",
    topic: "",
    args: {},
  });
}

function claim(conn: FakeConn, requestIds: string[]): void {
  conn.emit("data", { type: "sitrep-claim", requestIds });
}

const answersTo = (conn: FakeConn, requestId: string) =>
  conn.sent.filter(
    (m) =>
      typeof m === "object" &&
      m !== null &&
      (m as { requestId?: string }).requestId === requestId,
  );

async function flush(): Promise<void> {
  for (let i = 0; i < 5; i++) await Promise.resolve();
}

describe("a station's claim for the answer to its command", () => {
  afterEach(() => {
    setActiveTelemetryClientForTests(undefined);
    FakeHub.reset();
    localStorageMock.clear();
  });

  it("delivers the answer of a command still running when the station rejoins on a new link", async () => {
    const host = await startedHost();
    const settle = controllableClient();
    const first = await connectStation(host, "station-a-1", "cred-a");
    send(first, "a-0");
    await flush();
    first.close();

    const second = await connectStation(host, "station-a-2", "cred-a");
    claim(second, ["a-0"]);
    await flush();
    expect(answersTo(second, "a-0")).toEqual([]);

    settle.get("a-0")?.resolve({ applied: true });
    await flush();

    expect(answersTo(second, "a-0")).toMatchObject([
      { type: "sitrep-command-response", result: { applied: true } },
    ]);
    host.stop();
  });

  it("replays an answer that arrived while the station was away", async () => {
    const host = await startedHost();
    const settle = controllableClient();
    const first = await connectStation(host, "station-a-1", "cred-a");
    send(first, "a-0");
    await flush();
    first.close();
    settle.get("a-0")?.resolve({ applied: true });
    await flush();

    const second = await connectStation(host, "station-a-2", "cred-a");
    claim(second, ["a-0"]);
    await flush();

    expect(answersTo(second, "a-0")).toMatchObject([
      { type: "sitrep-command-response", result: { applied: true } },
    ]);
    host.stop();
  });

  it("says it holds no answer for a command it never saw", async () => {
    const host = await startedHost();
    controllableClient();
    const conn = await connectStation(host, "station-a-1", "cred-a");
    claim(conn, ["a-9"]);
    await flush();

    expect(answersTo(conn, "a-9")).toMatchObject([
      { type: "sitrep-command-error", code: FaultCode.ReplyNotReceived },
    ]);
    host.stop();
  });

  it("never hands one station the answer to another station's command", async () => {
    const host = await startedHost();
    const settle = controllableClient();
    const a = await connectStation(host, "station-a-1", "cred-a");
    send(a, "a-0");
    await flush();
    settle.get("a-0")?.resolve({ applied: true });
    await flush();

    const b = await connectStation(host, "station-b-1", "cred-b");
    claim(b, ["a-0"]);
    await flush();

    expect(answersTo(b, "a-0")).toMatchObject([
      { type: "sitrep-command-error", code: FaultCode.ReplyNotReceived },
    ]);
    host.stop();
  });
});
