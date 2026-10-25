import { describe, expect, it } from "vitest";
import {
  type BrokerPeer,
  ENDPOINT_SIGNAL,
  onSignal,
  sendSignal,
} from "./brokerSignal";

/** The slice of a Peer's broker socket the signal layer uses. */
function fakePeer() {
  const sent: unknown[] = [];
  const listeners = new Set<(m: unknown) => void>();
  const peer: BrokerPeer = {
    socket: {
      send: (m) => sent.push(m),
      on: (_e, cb) => listeners.add(cb),
      off: (_e, cb) => listeners.delete(cb),
    },
  };
  const deliver = (m: unknown) => {
    for (const cb of listeners) cb(m);
  };
  return { peer, sent, deliver, listeners };
}

describe("broker signals", () => {
  it("sends a join as a broker OFFER of its own payload type", () => {
    const { peer, sent } = fakePeer();
    sendSignal(peer, "gonogo-host-ABCD", "gne-1", { kind: "join", sdp: "v=0" });
    expect(sent).toEqual([
      {
        type: "OFFER",
        dst: "gonogo-host-ABCD",
        payload: {
          type: ENDPOINT_SIGNAL,
          connectionId: "gne-1",
          signal: { kind: "join", sdp: "v=0" },
        },
      },
    ]);
  });

  it("hears its own signals and nothing PeerJS sends for a connection", () => {
    const { peer, deliver } = fakePeer();
    const heard: unknown[] = [];
    onSignal(peer, (from, id, signal) => heard.push([from, id, signal]));
    deliver({
      type: "OFFER",
      src: "station-1",
      payload: { type: "data", connectionId: "dc_1", sdp: {} },
    });
    deliver({ type: "CANDIDATE", src: "station-1", payload: {} });
    deliver({
      type: "OFFER",
      src: "station-1",
      payload: {
        type: ENDPOINT_SIGNAL,
        connectionId: "gne-1",
        signal: { kind: "nonsense" },
      },
    });
    deliver({
      type: "OFFER",
      src: "gonogo-host-ABCD",
      payload: {
        type: ENDPOINT_SIGNAL,
        connectionId: "gne-1",
        signal: { kind: "direct" },
      },
    });
    expect(heard).toEqual([["gonogo-host-ABCD", "gne-1", { kind: "direct" }]]);
  });

  it("stops hearing once unsubscribed", () => {
    const { peer, listeners } = fakePeer();
    const off = onSignal(peer, () => {});
    expect(listeners.size).toBe(1);
    off();
    expect(listeners.size).toBe(0);
  });
});
