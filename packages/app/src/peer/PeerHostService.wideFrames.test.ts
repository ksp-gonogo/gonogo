/**
 * A relayed frame carrying numbers the PeerJS packer refuses must still reach a
 * station, with the host's values, and a frame that cannot be sent at all must
 * be reported rather than thrown out of the relaying listener.
 */

import { logger } from "@ksp-gonogo/logger";
import { afterEach, describe, expect, it, vi } from "vitest";

const { FakeHub } = vi.hoisted(() => {
  class FakeDataConnection {
    private listeners = new Map<string, Array<(...args: unknown[]) => void>>();
    peer: string;
    open = true;
    peerConnection = undefined;
    sent: Array<import("./protocol").PeerMessage> = [];
    pack: ((msg: import("./protocol").PeerMessage) => unknown) | undefined;
    failAll = false;

    constructor(peer: string) {
      this.peer = peer;
    }

    on(event: string, cb: (...args: unknown[]) => void) {
      const bucket = this.listeners.get(event) ?? [];
      bucket.push(cb);
      this.listeners.set(event, bucket);
    }

    emit(event: string, ...args: unknown[]) {
      for (const cb of this.listeners.get(event) ?? []) cb(...args);
    }

    send(msg: import("./protocol").PeerMessage) {
      if (this.failAll) throw new Error("channel closed");
      // The same packer PeerJS runs inside `send`, which throws synchronously.
      this.pack?.(msg);
      this.sent.push(msg);
    }

    close() {}
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

vi.mock("peerjs", async (importOriginal) => ({
  ...(await importOriginal<typeof import("peerjs")>()),
  default: FakeHub.Peer,
}));

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

import { util } from "peerjs";
import { asDataConnection } from "../test/peerFakes";
import { HOST_SESSION, PeerHostService } from "./PeerHostService";
import type { PeerMessage } from "./protocol";
import { decodeWideNumbers } from "./wideNumbers";

function bodiesFrame() {
  return {
    type: "stream-data" as const,
    topic: "system.bodies",
    payload: {
      bodies: [
        { name: "Sun", index: 0, mass: 1.7565459e28, radius: 261600000 },
        { name: "Kerbin", index: 1, mass: 5.2915158e22, radius: 600000 },
      ],
    },
  };
}

async function hostWithStation() {
  const host = new PeerHostService();
  await host.start();
  await Promise.resolve();
  const peer = FakeHub.Peer.registry.get(host.peerId ?? "");
  if (!peer) throw new Error("host peer not registered");
  const conn = new FakeHub.DataConnection("station-a");
  conn.pack = (msg) => util.pack(msg as Parameters<typeof util.pack>[0]);
  peer.emit("connection", asDataConnection(conn));
  conn.emit("open");
  await Promise.resolve();
  conn.sent.length = 0;
  return { host, conn };
}

describe("a relayed frame the packer refuses", () => {
  afterEach(() => {
    FakeHub.reset();
    localStorageMock.clear();
    vi.restoreAllMocks();
  });

  it("reaches the station with the host's own values", async () => {
    const { host, conn } = await hostWithStation();
    const frame = bodiesFrame();

    host.broadcastToVantage(HOST_SESSION, {
      type: "sitrep-frame",
      message: frame,
    } as PeerMessage);

    const sent = conn.sent[0];
    if (sent?.type !== "sitrep-frame") throw new Error("no frame was sent");
    expect(sent.wide).toBe(true);
    expect(decodeWideNumbers(sent.message)).toEqual(bodiesFrame());
    expect(frame.payload.bodies[1].mass).toBe(5.2915158e22);
    host.stop();
  });

  it("is reported with its topic, and does not throw, when it still cannot be sent", async () => {
    const { host, conn } = await hostWithStation();
    const error = vi.spyOn(logger, "error").mockImplementation(() => {});
    conn.failAll = true;

    expect(() =>
      host.broadcastToVantage(HOST_SESSION, {
        type: "sitrep-frame",
        message: bodiesFrame(),
      } as PeerMessage),
    ).not.toThrow();

    expect(error).toHaveBeenCalledWith(
      expect.stringContaining("topic=system.bodies"),
      expect.any(Error),
    );
    conn.failAll = false;
    host.stop();
  });
});
