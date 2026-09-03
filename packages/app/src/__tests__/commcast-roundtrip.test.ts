/**
 * A message crosses the mesh and arrives LATE at the other seat.
 *
 * Skips PeerJS entirely: the bridge is two callback sets mimicking the peer
 * host/client surfaces the thread services consume, the same shape
 * `maneuver-trigger-roundtrip.test.ts` uses. That keeps the test on the thread's
 * own contracts rather than dragging the real PeerJS stack along.
 *
 * What it is actually for: every piece of this works in isolation, and the
 * thing that can only be shown end to end is that the SAME message reaches two
 * seats at two different instants, which is the entire feature.
 */
import { PerfBudget } from "@ksp-gonogo/core";
import { afterEach, describe, expect, it } from "vitest";
import { CommcastClientService } from "../commcast/CommcastClientService";
import { CommcastHostService } from "../commcast/CommcastHostService";
import { CommcastPeerBridge } from "../commcast/CommcastPeerBridge";
import { deliveryFor, type Vantage } from "../commcast/reveal";
import type { CommsParticipant } from "../commcast/types";
import type { PeerClientService } from "../peer/PeerClientService";
import type { PeerHostService } from "../peer/PeerHostService";
import type { PeerMessage } from "../peer/protocol";

const KSC: CommsParticipant = {
  stationKey: "ksc-1",
  name: "Mission Control",
  seat: "mission-control",
  vantageId: "ksc",
};
const PILOT: CommsParticipant = {
  stationKey: "pilot-1",
  name: "Jeb",
  seat: "pilot",
  vantageId: "vessel:abc",
};
const GROUND_VANTAGE: Vantage = { seat: "mission-control", vantageId: "ksc" };
const ABOARD_VANTAGE: Vantage = { seat: "pilot", vantageId: "vessel:abc" };

/** Minimal PeerHostService stub: only the surface the thread's bridge uses. */
function fakePeerHost() {
  let sendCb:
    | ((
        peerId: string,
        msg: Extract<PeerMessage, { type: "commcast-send" }>,
      ) => void)
    | null = null;
  let readCb:
    | ((
        peerId: string,
        msg: Extract<PeerMessage, { type: "commcast-read" }>,
      ) => void)
    | null = null;
  let infoCb:
    | ((
        peerId: string,
        info: {
          name: string;
          stationKey?: string;
          seat?: "pilot" | "mission-control";
        },
      ) => void)
    | null = null;
  let onBroadcast: ((msg: PeerMessage) => void) | null = null;
  return {
    broadcast(msg: PeerMessage) {
      onBroadcast?.(msg);
    },
    onCommcastSend(cb: NonNullable<typeof sendCb>) {
      sendCb = cb;
      return () => {
        sendCb = null;
      };
    },
    onCommcastRead(cb: NonNullable<typeof readCb>) {
      readCb = cb;
      return () => {
        readCb = null;
      };
    },
    onStationInfo(cb: NonNullable<typeof infoCb>) {
      infoCb = cb;
      return () => {
        infoCb = null;
      };
    },
    feed(msg: PeerMessage, peerId = "peer-1") {
      if (msg.type === "commcast-send") sendCb?.(peerId, msg);
      if (msg.type === "commcast-read") readCb?.(peerId, msg);
    },
    feedStationInfo(
      peerId: string,
      info: Parameters<NonNullable<typeof infoCb>>[1],
    ) {
      infoCb?.(peerId, info);
    },
    setOnBroadcast(cb: (msg: PeerMessage) => void) {
      onBroadcast = cb;
    },
  };
}

/** Minimal PeerClientService stub. */
function fakePeerClient() {
  let snapCb: ((snap: never) => void) | null = null;
  let outgoing: PeerMessage[] = [];
  return {
    onCommcastSnapshot(cb: (snap: never) => void) {
      snapCb = cb;
      return () => {
        snapCb = null;
      };
    },
    sendCommcastMessage(author: CommsParticipant, input: unknown) {
      outgoing.push({ type: "commcast-send", author, input } as PeerMessage);
    },
    sendCommcastRead(
      reader: CommsParticipant,
      messageIds: string[],
      atUt: number,
    ) {
      outgoing.push({
        type: "commcast-read",
        reader,
        messageIds,
        atUt,
      } as PeerMessage);
    },
    deliver(msg: PeerMessage) {
      if (msg.type === "commcast-snapshot") snapCb?.(msg.snapshot as never);
    },
    drainOutgoing(): PeerMessage[] {
      const out = outgoing;
      outgoing = [];
      return out;
    },
  };
}

function wire() {
  localStorage.clear();
  const host = fakePeerHost();
  const client = fakePeerClient();
  const hostSvc = new CommcastHostService();
  const bridge = new CommcastPeerBridge(host as unknown as PeerHostService, {
    post: (author, input) => {
      hostSvc.post(author, input);
    },
    markRead: (reader, ids, atUt) => hostSvc.markRead(reader, ids, atUt),
    noteParticipant: (p) => hostSvc.noteParticipant(p),
  });
  hostSvc.subscribe((snap) => bridge.broadcastSnapshot(snap));
  host.setOnBroadcast((msg) => client.deliver(msg));
  const clientSvc = new CommcastClientService(
    client as unknown as PeerClientService,
  );
  return { host, client, hostSvc, clientSvc };
}

afterEach(() => {
  localStorage.clear();
  PerfBudget.getAll()
    .find((b) => b.name === "CommcastHostService snapshots/sec")
    ?.reset();
});

describe("Commcast, host to peer and back", () => {
  it("carries a peer's message into the canonical thread and back to every peer", () => {
    const { host, client, hostSvc, clientSvc } = wire();

    clientSvc.send(PILOT, {
      kind: "text",
      body: "staging nominal",
      sentUt: 1000,
      oneWaySeconds: 240,
      authorVantageId: "vessel:abc",
    });
    for (const msg of client.drainOutgoing()) host.feed(msg);

    expect(hostSvc.snapshot().messages).toHaveLength(1);
    /*
     * The peer's own copy comes back through the snapshot round-trip, never
     * from an optimistic local write: a message the host never received must
     * not sit in the author's thread looking delivered.
     */
    expect(clientSvc.snapshot().messages[0]?.body).toBe("staging nominal");
    expect(clientSvc.snapshot().messages[0]?.authorSeat).toBe("pilot");
  });

  it("reveals the SAME message at two seats at two different instants", () => {
    // The whole feature in one assertion.
    const { host, client, hostSvc, clientSvc } = wire();
    clientSvc.send(PILOT, {
      kind: "text",
      body: "burn complete",
      sentUt: 1000,
      oneWaySeconds: 240,
      authorVantageId: "vessel:abc",
    });
    for (const msg of client.drainOutgoing()) host.feed(msg);

    const msg = hostSvc.snapshot().messages[0];
    if (!msg) throw new Error("no message");

    // Aboard, where it was spoken: visible immediately.
    expect(deliveryFor(msg, ABOARD_VANTAGE, 1000).state).toBe("revealed");
    // On the ground, a light-time later, and not one second sooner.
    expect(deliveryFor(msg, GROUND_VANTAGE, 1239).state).toBe("in-transit");
    expect(deliveryFor(msg, GROUND_VANTAGE, 1240).state).toBe("revealed");
  });

  it("hands a peer that connects mid-flight the whole thread", () => {
    // The offline-delivery case, which is why the thread is host-authoritative
    // at all: `broadcast()` only reaches peers connected right now.
    const { hostSvc } = wire();
    hostSvc.post(KSC, {
      kind: "text",
      body: "we lost you at AOS",
      sentUt: 500,
      oneWaySeconds: 240,
    });

    const latecomer = fakePeerClient();
    const late = new CommcastClientService(
      latecomer as unknown as PeerClientService,
    );
    expect(late.snapshot().messages).toHaveLength(0);
    // What `createCommcastHost` sends on `onPeerConnect`.
    latecomer.deliver({
      type: "commcast-snapshot",
      snapshot: hostSvc.snapshot(),
    } as PeerMessage);
    expect(late.snapshot().messages[0]?.body).toBe("we lost you at AOS");
  });

  it("patches an author named after the fact, from station-info", () => {
    const { host, client, hostSvc, clientSvc } = wire();
    clientSvc.send(
      { ...PILOT, name: "" },
      {
        kind: "text",
        body: "who am I",
        sentUt: 1000,
        oneWaySeconds: 240,
      },
    );
    for (const msg of client.drainOutgoing()) host.feed(msg);
    expect(hostSvc.snapshot().messages[0]?.authorName).toBe("Pilot");

    host.feedStationInfo("peer-1", {
      name: "Jeb",
      stationKey: "pilot-1",
      seat: "pilot",
    });
    expect(hostSvc.snapshot().messages[0]?.authorName).toBe("Jeb");
    // And the peer's mirror is updated by the same broadcast, not left stale.
    expect(clientSvc.snapshot().messages[0]?.authorName).toBe("Jeb");
  });

  it("reads a peer's seat off station-info, defaulting a silent one to the ground", () => {
    const { host, hostSvc } = wire();
    host.feedStationInfo("peer-2", { name: "Old Client", stationKey: "old-1" });
    expect(hostSvc.knownParticipants()).toContainEqual({
      stationKey: "old-1",
      name: "Old Client",
      seat: "mission-control",
    });
  });

  it("carries a read receipt back and delays it across the same separation", () => {
    const { host, client, hostSvc, clientSvc } = wire();
    hostSvc.post(KSC, {
      kind: "text",
      body: "go for burn",
      sentUt: 1000,
      oneWaySeconds: 240,
    });
    const id = hostSvc.snapshot().messages[0]?.id;
    if (!id) throw new Error("no message");

    clientSvc.markRead(PILOT, [id], 1300);
    for (const msg of client.drainOutgoing()) host.feed(msg);

    const msg = hostSvc.snapshot().messages[0];
    if (!msg) throw new Error("no message");
    expect(msg.readBy).toHaveLength(1);
    // The ground learns they read it one light-time after they did, not at the
    // instant they tapped.
    const seen = (utNow: number) =>
      msg.readBy.filter(
        (r) => utNow >= r.atUt + (r.seat === "mission-control" ? 0 : 240),
      ).length;
    expect(seen(1400)).toBe(0);
    expect(seen(1540)).toBe(1);
  });
});
