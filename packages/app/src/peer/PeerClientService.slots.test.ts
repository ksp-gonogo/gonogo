/**
 * How a station finds the host among the four broker ids a join code owns: it
 * connects to all of them, a missing id is expected, and a host that says
 * hello with a higher generation replaces one it joined earlier.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { Fakes } = vi.hoisted(() => {
  class FakeConn {
    private listeners = new Map<string, Array<(...args: unknown[]) => void>>();
    open = false;
    closed = false;
    readonly sent: unknown[] = [];
    constructor(readonly peer: string) {}
    on(event: string, cb: (...args: unknown[]) => void) {
      const bucket = this.listeners.get(event) ?? [];
      bucket.push(cb);
      this.listeners.set(event, bucket);
    }
    emit(event: string, ...args: unknown[]) {
      for (const cb of this.listeners.get(event) ?? []) cb(...args);
    }
    close() {
      if (this.closed) return;
      this.closed = true;
      this.emit("close");
    }
    send(m: unknown) {
      this.sent.push(m);
    }
  }

  class FakePeer {
    static instances: FakePeer[] = [];
    private listeners = new Map<string, Array<(...args: unknown[]) => void>>();
    readonly conns = new Map<string, FakeConn>();
    destroyed = false;
    constructor(readonly id: string) {
      FakePeer.instances.push(this);
    }
    on(event: string, cb: (...args: unknown[]) => void) {
      const bucket = this.listeners.get(event) ?? [];
      bucket.push(cb);
      this.listeners.set(event, bucket);
    }
    emit(event: string, ...args: unknown[]) {
      for (const cb of this.listeners.get(event) ?? []) cb(...args);
    }
    connect(id: string) {
      const conn = new FakeConn(id);
      this.conns.set(id, conn);
      return conn;
    }
    destroy() {
      this.destroyed = true;
    }
  }
  return { Fakes: { Peer: FakePeer, Conn: FakeConn } };
});

vi.mock("peerjs", () => ({ default: Fakes.Peer }));

import { PeerClientService } from "./PeerClientService";
import { asPeerMessage } from "./protocol";

const ring = (slot: number) => `gonogo-host-ABCD-${slot}`;

function hello(generation: number, sessionToken = `session-${generation}`) {
  return {
    type: "hello",
    version: "1",
    buildTime: "t",
    sessionToken,
    generation,
  };
}

function missing(peer: InstanceType<typeof Fakes.Peer>, slot: number) {
  peer.emit(
    "error",
    Object.assign(new Error(`Could not connect to peer ${ring(slot)}`), {
      type: "peer-unavailable",
    }),
  );
}

/** Whether `conn` is the link the station announced itself on. */
function joinedTo(conn: InstanceType<typeof Fakes.Conn>): boolean {
  return conn.sent.some((m) => asPeerMessage(m)?.type === "station-credential");
}

function openedStation(
  options?: ConstructorParameters<typeof PeerClientService>[0],
) {
  const svc = new PeerClientService({ peerId: "station-test", ...options });
  svc.connect("abcd");
  const peer = Fakes.Peer.instances.at(-1);
  if (!peer) throw new Error("no peer");
  peer.emit("open", peer.id);
  expect(peer.conns.size).toBe(4);
  return { svc, peer };
}

beforeEach(() => {
  vi.useFakeTimers();
  Fakes.Peer.instances = [];
});
afterEach(() => {
  vi.useRealTimers();
});

describe("a station finding its host among the ring of broker ids", () => {
  it("joins slot 2 when only slot 2 is live, and reports nothing missing", () => {
    const { svc, peer } = openedStation();
    const reported: string[] = [];
    svc.onHostUnavailable((code) => reported.push(code));

    for (const slot of [0, 1, 3]) missing(peer, slot);
    const live = peer.conns.get(ring(2));
    live?.emit("open");
    live?.emit("data", hello(3));

    expect(reported).toEqual([]);
    expect(svc.getConnStatus()).toBe("connected");
    expect(live && joinedTo(live)).toBe(true);
    svc.disconnect();
  });

  it("reports the host missing once per attempt, only when all four slots are unavailable", () => {
    const { svc, peer } = openedStation({ retryIntervalMs: 50 });
    const reported: string[] = [];
    svc.onHostUnavailable((code) => reported.push(code));

    for (const slot of [0, 1, 2]) missing(peer, slot);
    expect(reported).toEqual([]);
    missing(peer, 3);

    expect(reported).toEqual(["abcd"]);
    svc.disconnect();
  });

  it("joins the slot that says hello without waiting for a slot that never answers", () => {
    const { svc, peer } = openedStation({ attemptDeadlineMs: 20_000 });
    const hung = peer.conns.get(ring(1));
    const live = peer.conns.get(ring(3));

    for (const slot of [0, 2]) missing(peer, slot);
    live?.emit("open");
    live?.emit("data", hello(4));

    expect(svc.getConnStatus()).toBe("connected");
    expect(live && joinedTo(live)).toBe(true);
    expect(hung?.closed).toBe(false);
    expect(Fakes.Peer.instances).toHaveLength(1);
    svc.disconnect();
  });

  it("ends joined to the higher generation when the lower says hello first", () => {
    const { svc, peer } = openedStation();
    for (const slot of [2, 3]) missing(peer, slot);
    const older = peer.conns.get(ring(0));
    const newer = peer.conns.get(ring(1));
    const restarts: number[] = [];
    svc.onHostRestart(() => restarts.push(1));

    older?.emit("open");
    older?.emit("data", hello(5));
    newer?.emit("open");
    newer?.emit("data", hello(6));

    expect(older && joinedTo(older)).toBe(true);
    expect(newer && joinedTo(newer)).toBe(true);
    expect(older?.closed).toBe(true);
    expect(newer?.closed).toBe(false);
    expect(svc.getConnStatus()).toBe("connected");
    expect(restarts).toHaveLength(1);
    svc.disconnect();
  });

  it("ends joined to the higher generation when the higher says hello first, and lets the lower go", () => {
    const { svc, peer } = openedStation();
    for (const slot of [2, 3]) missing(peer, slot);
    const older = peer.conns.get(ring(0));
    const newer = peer.conns.get(ring(1));

    newer?.emit("open");
    newer?.emit("data", hello(6));
    older?.emit("open");
    older?.emit("data", hello(5));

    expect(newer && joinedTo(newer)).toBe(true);
    expect(older && joinedTo(older)).toBe(false);
    expect(older?.closed).toBe(true);
    expect(newer?.closed).toBe(false);
    expect(svc.getConnStatus()).toBe("connected");
    svc.disconnect();
  });

  it("does not retry when the host it left closes after the switch", () => {
    const { svc, peer } = openedStation({ retryIntervalMs: 50 });
    for (const slot of [2, 3]) missing(peer, slot);
    const older = peer.conns.get(ring(0));
    const newer = peer.conns.get(ring(1));
    older?.emit("open");
    older?.emit("data", hello(5));
    newer?.emit("open");
    newer?.emit("data", hello(6));

    vi.advanceTimersByTime(5_000);

    expect(Fakes.Peer.instances).toHaveLength(1);
    expect(svc.getConnStatus()).toBe("connected");
    svc.disconnect();
  });

  it("retries as soon as every link it was waiting on has closed", () => {
    const { svc, peer } = openedStation({ retryIntervalMs: 50 });
    for (const slot of [0, 1, 2, 3]) peer.conns.get(ring(slot))?.close();

    vi.advanceTimersByTime(60);

    expect(Fakes.Peer.instances).toHaveLength(2);
    svc.disconnect();
  });
});

describe("a join page's look-up client", () => {
  it("asks the host for its facts in place of joining, and hears them", () => {
    const { svc, peer } = openedStation({ lookupOnly: true });
    const heard: unknown[] = [];
    svc.onGameFacts((facts) => heard.push(facts));

    for (const slot of [0, 1, 3]) missing(peer, slot);
    const live = peer.conns.get(ring(2));
    live?.emit("open");
    live?.emit("data", hello(1));
    live?.emit("data", {
      type: "game-facts",
      hostSeat: "pilot",
      stations: 2,
      pilots: 1,
    });

    const sentTypes = (live?.sent ?? []).map((m) => asPeerMessage(m)?.type);
    expect(sentTypes).toEqual(["game-lookup"]);
    expect(heard).toEqual([{ hostSeat: "pilot", stations: 2, pilots: 1 }]);
    svc.disconnect();
  });
});

describe("the host's seat as a station hears it", () => {
  it("is mission control until the host says otherwise", () => {
    const { svc, peer } = openedStation();
    const live = peer.conns.get(ring(0));
    live?.emit("open");
    live?.emit("data", hello(1));
    expect(svc.getHostSeat()).toBe("main");
    const seen: string[] = [];
    svc.onHostSeatChange((seat) => seen.push(seat));
    live?.emit("data", { type: "host-seat", seat: "pilot" });
    expect(svc.getHostSeat()).toBe("pilot");
    expect(seen).toEqual(["pilot"]);
    svc.disconnect();
  });
});
