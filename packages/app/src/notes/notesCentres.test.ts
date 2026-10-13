/**
 * Notes are kept per command centre: a station is sent the list of the centre
 * it stands at, which is the vantage it asked for or else the host's own.
 * Runs the real host service and bridge over a fake peer hub.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

const { FakeHub } = vi.hoisted(() => {
  class FakeDataConnection {
    private listeners = new Map<string, Array<(...args: unknown[]) => void>>();
    peer: string;
    open = true;
    peerConnection = undefined;
    sent: PeerMessage[] = [];

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

    send(msg: PeerMessage) {
      this.sent.push(msg);
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

const store = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => store.set(k, v),
  removeItem: (k: string) => store.delete(k),
  clear: () => store.clear(),
});

import { PeerHostService } from "../peer/PeerHostService";
import type { PeerMessage } from "../peer/protocol";
import { createNotesHost } from "./createNotesHost";
import type { NotesSnapshot } from "./types";

const HOME = "ground:home";
const CREW = "vessel:abc-123";

type FakeConn = InstanceType<typeof FakeHub.DataConnection>;

async function startedHost(): Promise<PeerHostService> {
  const host = new PeerHostService();
  await host.start();
  await Promise.resolve();
  return host;
}

async function connectStation(
  host: PeerHostService,
  peerId: string,
): Promise<FakeConn> {
  const peer = FakeHub.Peer.registry.get(host.peerId ?? "");
  if (!peer) throw new Error("host peer not registered");
  const conn = new FakeHub.DataConnection(peerId);
  peer.emit("connection", conn);
  conn.emit("open");
  await Promise.resolve();
  return conn;
}

const snapshots = (conn: FakeConn): NotesSnapshot[] =>
  conn.sent.flatMap((m) => (m.type === "notes-snapshot" ? [m.snapshot] : []));

const lastBodies = (conn: FakeConn): string[] =>
  (snapshots(conn).at(-1)?.notes ?? []).map((n) => n.body);

const results = (conn: FakeConn) =>
  conn.sent.flatMap((m) => (m.type === "note-result" ? [m] : []));

const send = (conn: FakeConn, msg: Record<string, unknown>) =>
  conn.emit("data", msg);

describe("notes per command centre", () => {
  afterEach(() => {
    FakeHub.reset();
    store.clear();
  });

  it("sends a station the list of the host's centre when it connects", async () => {
    const host = await startedHost();
    host.setCommandCentre(HOME);
    const service = createNotesHost(host);
    service.addNote(HOME, { body: "home note" });

    const station = await connectStation(host, "station-a");

    expect(lastBodies(station)).toEqual(["home note"]);
    host.stop();
  });

  it("does not send a note to a station at another centre", async () => {
    const host = await startedHost();
    host.setCommandCentre(HOME);
    const service = createNotesHost(host);
    const atHome = await connectStation(host, "station-home");
    const atCrew = await connectStation(host, "station-crew");
    send(atCrew, { type: "sitrep-set-vantage", vantage: CREW });
    const heardByCrew = snapshots(atCrew).length;

    service.addNote(HOME, { body: "for home only" });

    expect(lastBodies(atHome)).toEqual(["for home only"]);
    expect(snapshots(atCrew)).toHaveLength(heardByCrew);
    expect(lastBodies(atCrew)).toEqual([]);
    host.stop();
  });

  it("keeps a note written at one centre out of the other's list", async () => {
    const host = await startedHost();
    host.setCommandCentre(HOME);
    createNotesHost(host);
    const atHome = await connectStation(host, "station-home");
    const atCrew = await connectStation(host, "station-crew");
    send(atCrew, { type: "sitrep-set-vantage", vantage: CREW });

    send(atCrew, { type: "note-add", ref: "r1", body: "crew note" });

    expect(lastBodies(atCrew)).toEqual(["crew note"]);
    expect(lastBodies(atHome)).toEqual([]);
    expect(results(atCrew)).toEqual([
      { type: "note-result", ref: "r1", ok: true },
    ]);
    host.stop();
  });

  it("sends a station the other centre's list when it moves there", async () => {
    const host = await startedHost();
    host.setCommandCentre(HOME);
    const service = createNotesHost(host);
    service.addNote(HOME, { body: "home note" });
    service.addNote(CREW, { body: "crew note" });
    const station = await connectStation(host, "station-a");
    expect(lastBodies(station)).toEqual(["home note"]);

    send(station, { type: "sitrep-set-vantage", vantage: CREW });
    expect(lastBodies(station)).toEqual(["crew note"]);

    send(station, { type: "sitrep-set-vantage", vantage: null });
    expect(lastBodies(station)).toEqual(["home note"]);
    host.stop();
  });

  it("moves a station that follows the host when the host changes centre", async () => {
    const host = await startedHost();
    host.setCommandCentre(HOME);
    const service = createNotesHost(host);
    service.addNote(HOME, { body: "home note" });
    service.addNote(CREW, { body: "crew note" });
    const follower = await connectStation(host, "follower");
    const chooser = await connectStation(host, "chooser");
    send(chooser, { type: "sitrep-set-vantage", vantage: HOME });

    host.setCommandCentre(CREW);

    expect(lastBodies(follower)).toEqual(["crew note"]);
    // A station that chose its own centre stays where it is.
    expect(lastBodies(chooser)).toEqual(["home note"]);
    host.stop();
  });

  it("refuses a station's edit to a note another screen changed first, and keeps the first text", async () => {
    const host = await startedHost();
    host.setCommandCentre(HOME);
    const service = createNotesHost(host);
    const note = service.addNote(HOME, { body: "start" });
    const a = await connectStation(host, "station-a");
    const b = await connectStation(host, "station-b");

    send(a, {
      type: "note-update",
      ref: "a1",
      id: note.id,
      body: "from a",
      baseVersion: 1,
    });
    send(b, {
      type: "note-update",
      ref: "b1",
      id: note.id,
      body: "from b",
      baseVersion: 1,
    });

    expect(results(a)[0]).toMatchObject({ ref: "a1", ok: true });
    expect(results(b)[0]).toMatchObject({ ref: "b1", ok: false });
    expect(results(b)[0].current?.body).toBe("from a");
    expect(service.snapshot(HOME).notes[0].body).toBe("from a");
    host.stop();
  });

  it("refuses a station's change while the host has no centre and sends it an empty list", async () => {
    const host = await startedHost();
    const service = createNotesHost(host);
    const station = await connectStation(host, "station-a");

    send(station, { type: "note-add", ref: "r1", body: "nowhere to go" });

    expect(results(station)[0]).toMatchObject({ ref: "r1", ok: false });
    expect(snapshots(station).at(-1)).toEqual({ centreId: null, notes: [] });
    expect(service.snapshot(HOME).notes).toEqual([]);
    host.stop();
  });

  it("holds the old single list until the host has a centre, then gives it to that one", async () => {
    store.set(
      "gonogo.notes.v1",
      JSON.stringify([
        { id: "o1", body: "old note", order: 0, createdAt: 0, updatedAt: 0 },
      ]),
    );
    const host = await startedHost();
    const service = createNotesHost(host);
    const atCrew = await connectStation(host, "station-crew");
    send(atCrew, { type: "sitrep-set-vantage", vantage: CREW });
    expect(lastBodies(atCrew)).toEqual([]);
    expect(store.has("gonogo.notes.v1")).toBe(true);

    host.setCommandCentre(HOME);

    expect(service.snapshot(HOME).notes.map((n) => n.body)).toEqual([
      "old note",
    ]);
    expect(lastBodies(atCrew)).toEqual([]);
    expect(store.has("gonogo.notes.v1")).toBe(false);
    host.stop();
  });
});
