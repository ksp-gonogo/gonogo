/**
 * What a station reads from a host, and what the host keeps of its reads while
 * the game is still answering whether the station is approved.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

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

    send(_msg?: unknown) {}

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

import { makeMeta } from "@ksp-gonogo/sitrep-sdk/testing";
import { render } from "@ksp-gonogo/test-utils";
import {
  type OpenVantageSession,
  SitrepVantageSessions,
  type VantageSession,
} from "../telemetry/SitrepVantageSessions";
import { MemoryApprovalBook } from "../test/approveStation";
import type { ApprovalBook, ApprovalLookup } from "./approvalBook";
import { HOME_SESSION, PeerHostService } from "./PeerHostService";
import { asPeerMessage, type PeerMessage } from "./protocol";

type FakeConn = InstanceType<typeof FakeHub.DataConnection>;

const TOPIC = "thirdparty.readout";
const CRAFT = "vessel:abc-123";

/** A book that answers each lookup only when the test lets it, as the game does over a round trip. */
class SlowBook implements ApprovalBook {
  private readonly book = new MemoryApprovalBook();
  private readonly pending: Array<() => void> = [];

  lookup(credential: string): Promise<ApprovalLookup> {
    const answer = this.book.lookup(credential);
    return new Promise((resolve) => {
      this.pending.push(() => resolve(answer));
    });
  }

  approve(credential: string, name: string): void {
    this.book.approve(credential, name);
  }

  revoke(stationId: string): void {
    this.book.revoke(stationId);
  }

  /** The game's answer arrives for every lookup asked so far. */
  async answer(): Promise<void> {
    for (const settle of this.pending.splice(0)) settle();
    for (let i = 0; i < 10; i++) await Promise.resolve();
  }
}

interface Station {
  conn: FakeConn;
  told: PeerMessage[];
}

async function startedHost(book: ApprovalBook): Promise<PeerHostService> {
  const host = new PeerHostService();
  host.attachApprovals(book);
  await host.adoptShareCode("ABC234");
  await host.start();
  await Promise.resolve();
  return host;
}

/** A station that has opened its link and sent its credential, approved or not. */
async function join(
  host: PeerHostService,
  peerId: string,
  credential: string,
): Promise<Station> {
  const peer = FakeHub.Peer.registry.get(host.peerId ?? "");
  if (!peer) throw new Error("host peer not registered");
  const conn = new FakeHub.DataConnection(peerId, true);
  const told: PeerMessage[] = [];
  conn.send = (msg?: unknown) => {
    const message = asPeerMessage(msg);
    if (conn.open && message) told.push(message);
  };
  peer.emit("connection", conn);
  conn.emit("open");
  await Promise.resolve();
  conn.emit("data", { type: "station-credential", credential });
  conn.emit("data", {
    type: "station-info",
    name: "Flight",
    stationKey: peerId,
  });
  return { conn, told };
}

function makeSink() {
  const live = new Set<string>();
  return {
    live,
    subscribe(topic: string) {
      live.add(topic);
      return () => live.delete(topic);
    },
    requestRate: () => () => {},
    cachedFrames: () => [],
  };
}

function newBook(): MemoryApprovalBook {
  return new MemoryApprovalBook();
}

afterEach(() => {
  FakeHub.reset();
  localStorageMock.clear();
});

describe("a pilot's host, which serves plain stations at home", () => {
  it("asks for the home session while a plain station is admitted, and gives it up when the last leaves", async () => {
    const book = newBook();
    book.approve("cred-a", "Flight");
    const host = await startedHost(book);
    const release = host.servePlainStationsAtHome();
    const wanted: Array<readonly string[]> = [];
    host.onRequestedVantagesChanged((v) => wanted.push([...v]));
    wanted.length = 0;

    const station = await join(host, "station-a", "cred-a");
    await Promise.resolve();
    expect(wanted.at(-1)).toEqual([HOME_SESSION]);

    station.conn.close();
    expect(wanted.at(-1)).toEqual([]);
    release();
    host.stop();
  });

  it("delivers a home-session frame to a plain station that subscribed a topic", async () => {
    const book = newBook();
    book.approve("cred-a", "Flight");
    const host = await startedHost(book);
    const release = host.servePlainStationsAtHome();
    const opened: string[] = [];
    const topics = new Map<string, Set<string>>();
    const listeners = new Map<string, (m: unknown) => void>();
    const openSession: OpenVantageSession = (vantage) => {
      opened.push(vantage);
      const held = new Set<string>();
      topics.set(vantage, held);
      const session: VantageSession = {
        subscribe: (topic) => {
          held.add(topic);
          return () => held.delete(topic);
        },
        requestRate: () => () => {},
        onRawMessage: (cb) => {
          listeners.set(vantage, cb as (m: unknown) => void);
          return () => listeners.delete(vantage);
        },
        dispose: () => {},
      };
      return session;
    };
    const view = render(
      <SitrepVantageSessions peerHost={host} openSession={openSession} />,
    );

    const station = await join(host, "station-a", "cred-a");
    await Promise.resolve();
    station.conn.emit("data", { type: "sitrep-subscribe", topic: TOPIC });
    expect(opened).toEqual([HOME_SESSION]);
    expect(topics.get(HOME_SESSION)?.has(TOPIC)).toBe(true);

    listeners.get(HOME_SESSION)?.({
      type: "stream-data",
      topic: TOPIC,
      payload: { n: 1 },
      meta: makeMeta(),
    });
    expect(station.told.some((m) => m.type === "sitrep-frame")).toBe(true);

    view.unmount();
    release();
    host.stop();
  });
});

describe("a station that reads before the game has answered whether it is approved", () => {
  it("is served the vantage and topics it asked for once approved, and nothing before", async () => {
    const book = new SlowBook();
    book.approve("cred-a", "Flight");
    const host = await startedHost(book);
    const sink = makeSink();
    const craftSink = makeSink();
    host.attachSitrepSink(sink);
    host.attachSitrepSinkFor(CRAFT, craftSink);

    const station = await join(host, "station-a", "cred-a");
    station.conn.emit("data", { type: "sitrep-set-vantage", vantage: CRAFT });
    station.conn.emit("data", { type: "sitrep-subscribe", topic: TOPIC });
    expect(craftSink.live.size).toBe(0);
    expect(sink.live.size).toBe(0);
    expect(host.requestedVantages()).toEqual([]);

    await book.answer();

    expect(craftSink.live.has(TOPIC)).toBe(true);
    expect(sink.live.size).toBe(0);
    expect(host.requestedVantages()).toEqual([CRAFT]);
    host.stop();
  });

  it("holds the topics it left and the rate tiers it set", async () => {
    const book = new SlowBook();
    book.approve("cred-a", "Flight");
    const host = await startedHost(book);
    const rates = new Map<string, string>();
    const sink = {
      ...makeSink(),
      requestRate(topic: string, tier: string) {
        rates.set(topic, tier);
        return () => rates.delete(topic);
      },
    };
    host.attachSitrepSink(sink);

    const station = await join(host, "station-a", "cred-a");
    station.conn.emit("data", { type: "sitrep-subscribe", topic: TOPIC });
    station.conn.emit("data", { type: "sitrep-subscribe", topic: "other" });
    station.conn.emit("data", { type: "sitrep-unsubscribe", topic: "other" });
    station.conn.emit("data", {
      type: "sitrep-set-rate",
      topic: TOPIC,
      tier: "high",
    });
    await book.answer();

    expect([...sink.live]).toEqual([TOPIC]);
    expect(rates.get(TOPIC)).toBe("high");
    host.stop();
  });

  it("keeps nothing of a station that is refused", async () => {
    const book = new SlowBook();
    const host = await startedHost(book);
    const sink = makeSink();
    host.attachSitrepSink(sink);

    const station = await join(host, "station-a", "cred-unknown");
    station.conn.emit("data", { type: "sitrep-subscribe", topic: TOPIC });
    await book.answer();
    host.refuseStation("station-a");
    station.conn.close();

    expect(sink.live.size).toBe(0);
    expect(host.requestedVantages()).toEqual([]);
    host.stop();
  });

  it("counts a vote it sent while waiting once the station is approved", async () => {
    const book = new SlowBook();
    book.approve("cred-a", "Flight");
    const host = await startedHost(book);
    const votes: Array<[string, string | null]> = [];
    host.onGonogoVote((peerId, status) => votes.push([peerId, status]));

    const station = await join(host, "station-a", "cred-a");
    station.conn.emit("data", { type: "gonogo-vote", status: "no-go" });
    expect(votes).toEqual([]);
    await book.answer();

    expect(votes).toEqual([["station-a", "no-go"]]);
    host.stop();
  });

  it("still refuses a write while waiting", async () => {
    const book = new SlowBook();
    book.approve("cred-a", "Flight");
    const host = await startedHost(book);
    const station = await join(host, "station-a", "cred-a");
    station.conn.emit("data", { type: "gonogo-vote", status: "go" });
    expect(station.told).toContainEqual(
      expect.objectContaining({
        type: "station-write-refused",
        refused: "gonogo-vote",
      }),
    );
    host.stop();
  });
});
