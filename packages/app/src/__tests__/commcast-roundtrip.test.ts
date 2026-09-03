/**
 * A message crosses the mesh, arrives LATE at the vantage it names, and is
 * acknowledged back across the same separation.
 *
 * Skips PeerJS entirely: the mesh runs over two callback sets mimicking the
 * peer host/client surfaces, the same shape `maneuver-trigger-roundtrip.test.ts`
 * uses. That keeps the test on Commcast's own contracts rather than dragging
 * the real PeerJS stack along.
 *
 * What it is actually for: every piece works in isolation, and the things that
 * can only be shown end to end are that two vantages hold different SETS, that
 * the relay stores nothing on anybody's behalf, and that the author's own
 * confirmation is a full round trip late.
 */
import { PerfBudget } from "@ksp-gonogo/core";
import { afterEach, describe, expect, it } from "vitest";
import { CommcastLog } from "../commcast/CommcastLog";
import { CommcastMesh } from "../commcast/CommcastMesh";
import {
  sentArrivalUtFor,
  sentPhaseFor,
  type Vantage,
} from "../commcast/reveal";
import type { PeerClientService } from "../peer/PeerClientService";
import type { PeerHostService } from "../peer/PeerHostService";
import type { PeerMessage } from "../peer/protocol";

const KSC = "ksc";
const ARES = "vessel:ares";
const WOOMERA = "ground:woomera";
const LIGHT_TIME = 240;

const GROUND: Vantage = { seat: "mission-control", vantageId: KSC };
const ABOARD: Vantage = { seat: "pilot", vantageId: ARES };

const FLIGHT = {
  stationKey: "ksc-1",
  name: "Kennedy Flight",
  seat: "mission-control" as const,
  vantageId: KSC,
};
const JEB = {
  stationKey: "pilot-1",
  name: "Jeb",
  seat: "pilot" as const,
  vantageId: ARES,
};

type Transmit = Extract<PeerMessage, { type: "commcast-transmit" }>;
type Ack = Extract<PeerMessage, { type: "commcast-ack" }>;

/**
 * The star, wired by hand: peers speak only to the host, and the host repeats
 * what it hears. Every frame reaches every participant, which is the property
 * the addressing rule has to survive.
 */
function fakeMesh() {
  const fromPeers: Array<(peerId: string, msg: PeerMessage) => void> = [];
  const toPeers: Array<(msg: PeerMessage) => void> = [];

  const host = {
    broadcast: (msg: PeerMessage) => {
      for (const cb of toPeers) cb(msg);
    },
    onCommcastTransmit: (cb: (peerId: string, msg: Transmit) => void) => {
      const fn = (peerId: string, msg: PeerMessage) => {
        if (msg.type === "commcast-transmit") cb(peerId, msg);
      };
      fromPeers.push(fn);
      return () => {
        fromPeers.splice(fromPeers.indexOf(fn), 1);
      };
    },
    onCommcastAck: (cb: (peerId: string, msg: Ack) => void) => {
      const fn = (peerId: string, msg: PeerMessage) => {
        if (msg.type === "commcast-ack") cb(peerId, msg);
      };
      fromPeers.push(fn);
      return () => {
        fromPeers.splice(fromPeers.indexOf(fn), 1);
      };
    },
  } as unknown as PeerHostService;

  function peer(): PeerClientService {
    return {
      sendCommcastMessage: (msg: Transmit["msg"]) => {
        for (const cb of fromPeers)
          cb("peer", { type: "commcast-transmit", msg });
      },
      sendCommcastAck: (ack: Ack["ack"]) => {
        for (const cb of fromPeers) cb("peer", { type: "commcast-ack", ack });
      },
      onCommcastTransmit: (cb: (msg: Transmit["msg"]) => void) => {
        const fn = (msg: PeerMessage) => {
          if (msg.type === "commcast-transmit") cb(msg.msg);
        };
        toPeers.push(fn);
        return () => {
          toPeers.splice(toPeers.indexOf(fn), 1);
        };
      },
      onCommcastAck: (cb: (ack: Ack["ack"]) => void) => {
        const fn = (msg: PeerMessage) => {
          if (msg.type === "commcast-ack") cb(msg.ack);
        };
        toPeers.push(fn);
        return () => {
          toPeers.splice(toPeers.indexOf(fn), 1);
        };
      },
    } as unknown as PeerClientService;
  }

  return { host, peer };
}

function memoryStorage(): Storage {
  const m = new Map<string, string>();
  return {
    get length() {
      return m.size;
    },
    clear: () => m.clear(),
    key: (i: number) => [...m.keys()][i] ?? null,
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => {
      m.set(k, String(v));
    },
    removeItem: (k: string) => {
      m.delete(k);
    },
  } as Storage;
}

/** One participant: its own log, attached to its own end of the mesh. */
function participant(
  screenKey: string,
  vantageId: string,
  attach: (log: CommcastLog) => CommcastMesh,
) {
  const log = new CommcastLog({ screenKey, storage: memoryStorage() });
  log.setVantage(vantageId);
  const mesh = attach(log);
  log.setTransmitter(mesh);
  return { log, mesh };
}

const meshes: CommcastMesh[] = [];
afterEach(() => {
  for (const m of meshes.splice(0)) m.dispose();
  for (const b of PerfBudget.getAll()) b.reset();
});

function scene() {
  const wire = fakeMesh();
  const ground = participant("ksc-1", KSC, (log) =>
    CommcastMesh.forHost(wire.host, "ksc-1", {
      onMessage: (msg) => log.receiveTransmission(msg),
      onAck: (ack) => log.receiveAck(ack),
    }),
  );
  const aboard = participant("pilot-1", ARES, (log) =>
    CommcastMesh.forClient(wire.peer(), "pilot-1", {
      onMessage: (msg) => log.receiveTransmission(msg),
      onAck: (ack) => log.receiveAck(ack),
    }),
  );
  const range = participant("woomera-1", WOOMERA, (log) =>
    CommcastMesh.forClient(wire.peer(), "woomera-1", {
      onMessage: (msg) => log.receiveTransmission(msg),
      onAck: (ack) => log.receiveAck(ack),
    }),
  );
  meshes.push(ground.mesh, aboard.mesh, range.mesh);
  return { ground, aboard, range };
}

describe("Commcast, addressed across the mesh", () => {
  it("reaches the vantage it names and NOBODY else", () => {
    const { ground, aboard, range } = scene();
    ground.log.send(FLIGHT, {
      kind: "text",
      body: "Ares, Kennedy. Go for the burn.",
      to: [ARES],
      sentUt: 1000,
      separationSeconds: LIGHT_TIME,
    });
    // Woomera saw the frame go past, because the star gives it no choice, and
    // kept nothing. That is the whole ownership rule in one assertion.
    expect(aboard.log.snapshot().pending).toHaveLength(1);
    expect(range.log.snapshot().pending).toHaveLength(0);
    expect(range.log.snapshot().inbox).toHaveLength(0);
  });

  it("leaves the relay holding nothing on anybody else's behalf", () => {
    const { ground, aboard } = scene();
    aboard.log.send(JEB, {
      kind: "text",
      body: "Woomera, Ares. Reading you.",
      to: [WOOMERA],
      sentUt: 1000,
      separationSeconds: LIGHT_TIME,
    });
    // The ground is the ROUTER for this message and not its owner: it repeated
    // the frame and kept no copy. A host-authoritative thread would have one.
    expect(ground.log.snapshot().inbox).toHaveLength(0);
    expect(ground.log.snapshot().pending).toHaveLength(0);
  });

  it("confirms the author a FULL round trip after they spoke", () => {
    const { ground, aboard } = scene();
    const msg = ground.log.send(FLIGHT, {
      kind: "text",
      body: "Ares, Kennedy. Go for the burn.",
      to: [ARES],
      sentUt: 1000,
      separationSeconds: LIGHT_TIME,
    });
    // At 1240 it lands aboard and is acknowledged at that instant.
    aboard.log.release(msg.id, {
      from: ARES,
      stationKey: "pilot-1",
      seat: "pilot",
      atUt: 1000 + LIGHT_TIME,
    });
    const out = () => ground.log.snapshot().outbox[0];
    expect(sentPhaseFor(out(), GROUND, 1479)).toBe("awaiting-reply");
    expect(sentPhaseFor(out(), GROUND, 1480)).toBe("confirmed");
    // Which is also when the author's own words enter their own log: an echo
    // after the round trip, the kOS terminal's rule on a spoken line.
    expect(sentArrivalUtFor(out(), GROUND, 1480)).toBe(1480);
  });

  it("gives two vantages different SETS, not merely different orders", () => {
    const { ground, aboard, range } = scene();
    ground.log.send(FLIGHT, {
      kind: "text",
      body: "for the crew",
      to: [ARES],
      sentUt: 1000,
      separationSeconds: LIGHT_TIME,
    });
    ground.log.send(FLIGHT, {
      kind: "text",
      body: "for the range",
      to: [WOOMERA],
      sentUt: 1010,
      separationSeconds: 12,
    });
    expect(aboard.log.snapshot().pending.map((m) => m.body)).toEqual([
      "for the crew",
    ]);
    expect(range.log.snapshot().pending.map((m) => m.body)).toEqual([
      "for the range",
    ]);
  });

  it("delivers ONE message when a resend and its original both arrive", () => {
    const { ground, aboard } = scene();
    const msg = ground.log.send(FLIGHT, {
      kind: "text",
      body: "do you copy",
      to: [ARES],
      sentUt: 1000,
      separationSeconds: LIGHT_TIME,
    });
    ground.log.resend(msg.id, 2000, LIGHT_TIME);
    expect(aboard.log.snapshot().pending).toHaveLength(1);
  });

  it("carries an acknowledgement back to the author and to nobody else", () => {
    const { ground, aboard, range } = scene();
    const msg = ground.log.send(FLIGHT, {
      kind: "text",
      body: "do you copy",
      to: [ARES],
      sentUt: 1000,
      separationSeconds: LIGHT_TIME,
    });
    aboard.log.release(msg.id, {
      from: ARES,
      stationKey: "pilot-1",
      seat: "pilot",
      atUt: 1240,
    });
    expect(ground.log.snapshot().outbox[0].acks).toHaveLength(1);
    // Woomera has no outbox entry for it, so the ack it saw pass changed
    // nothing there.
    expect(range.log.snapshot().outbox).toHaveLength(0);
  });

  it("never transmits a message with no path, and keeps it for the author", () => {
    const { ground, aboard } = scene();
    ground.log.send(FLIGHT, {
      kind: "text",
      body: "Ares, do you read",
      to: [ARES],
      sentUt: 1000,
      separationSeconds: null,
    });
    expect(aboard.log.snapshot().pending).toHaveLength(0);
    const [out] = ground.log.snapshot().outbox;
    expect(out.neverLeft).toBe(true);
    // Unconfirmed and recoverable: the author still has their words, and the
    // one action attached to them is a resend.
    expect(sentPhaseFor(out, GROUND, 9999)).toBe("lost");
    expect(sentArrivalUtFor(out, GROUND, 1000)).toBe(1000);
  });

  it("ignores its own frames coming back round the relay", () => {
    const { ground } = scene();
    ground.log.send(FLIGHT, {
      kind: "text",
      body: "to the crew",
      to: [KSC],
      sentUt: 1000,
      separationSeconds: 0,
    });
    // Addressed to its OWN vantage, so the echo would land in its own inbox if
    // the author filter keyed on the vantage rather than on the station.
    expect(ground.log.snapshot().pending).toHaveLength(0);
  });

  it("stays inside its transmission budget on an ordinary exchange", () => {
    const { ground, aboard } = scene();
    const msg = ground.log.send(FLIGHT, {
      kind: "text",
      body: "do you copy",
      to: [ARES],
      sentUt: 1000,
      separationSeconds: LIGHT_TIME,
    });
    aboard.log.release(msg.id, {
      from: ARES,
      stationKey: "pilot-1",
      seat: "pilot",
      atUt: 1240,
    });
    const budget = PerfBudget.getAll().find(
      (b) => b.name === "CommcastLog transmissions/sec",
    );
    expect(budget?.getExceedanceCount()).toBe(0);
  });
});

/** A station reading at the host's vantage is genuinely co-located with it. */
describe("Commcast, a station beside its host", () => {
  it("hears a message addressed to the vantage they share", () => {
    const wire = fakeMesh();
    const host = participant("ksc-1", KSC, (log) =>
      CommcastMesh.forHost(wire.host, "ksc-1", {
        onMessage: (msg) => log.receiveTransmission(msg),
        onAck: (ack) => log.receiveAck(ack),
      }),
    );
    const station = participant("station-1", KSC, (log) =>
      CommcastMesh.forClient(wire.peer(), "station-1", {
        onMessage: (msg) => log.receiveTransmission(msg),
        onAck: (ack) => log.receiveAck(ack),
      }),
    );
    const aboard = participant("pilot-1", ARES, (log) =>
      CommcastMesh.forClient(wire.peer(), "pilot-1", {
        onMessage: (msg) => log.receiveTransmission(msg),
        onAck: (ack) => log.receiveAck(ack),
      }),
    );
    meshes.push(host.mesh, station.mesh, aboard.mesh);
    aboard.log.send(JEB, {
      kind: "text",
      body: "Kennedy, Ares. Burn complete.",
      to: [KSC],
      sentUt: 1000,
      separationSeconds: LIGHT_TIME,
    });
    expect(host.log.snapshot().pending).toHaveLength(1);
    expect(station.log.snapshot().pending).toHaveLength(1);
    // And it reaches them at the same instant, because they are at one vantage.
    expect(
      sentArrivalUtFor(aboard.log.snapshot().outbox[0], ABOARD, 1000),
    ).toBeUndefined();
  });
});
