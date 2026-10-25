import { ws } from "msw";
import { setupServer } from "msw/node";
import type { DataConnection } from "peerjs";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";

/**
 * The station-to-host data channel's delivery guarantee, asserted on what the
 * installed PeerJS hands to WebRTC rather than on the options we pass it.
 *
 * Nothing in this repo is faked. The broker is an MSW `ws` link that answers
 * PeerJS's handshake with `OPEN`, and `RTCPeerConnection` (absent from jsdom)
 * is a recorder that captures the `RTCDataChannelInit` PeerJS builds. PeerJS
 * sniffs `RTCPeerConnection` once at module load, so the recorder goes on the
 * global and the modules are re-imported after it.
 */

interface RecordedChannel {
  label: string;
  init: RTCDataChannelInit | undefined;
}

const recorded: RecordedChannel[] = [];

class RecordingPeerConnection extends EventTarget {
  iceConnectionState = "new";
  iceGatheringState = "new";
  connectionState = "new";
  signalingState = "stable";
  onicecandidate: unknown = null;
  oniceconnectionstatechange: unknown = null;
  ondatachannel: unknown = null;
  ontrack: unknown = null;

  createDataChannel(label: string, init?: RTCDataChannelInit) {
    recorded.push({ label, init });
    return Object.assign(new EventTarget(), {
      label,
      ordered: init?.ordered ?? true,
      readyState: "connecting",
      binaryType: "blob",
      bufferedAmount: 0,
      onopen: null,
      onmessage: null,
      onclose: null,
      close() {},
    });
  }

  /* An offer for a host that is not in this test; the broker below answers only the join request. */
  createOffer() {
    return Promise.resolve<RTCSessionDescriptionInit>({
      type: "offer",
      sdp: "v=0",
    });
  }

  localDescription: RTCSessionDescriptionInit | null = null;

  setLocalDescription(description: RTCSessionDescriptionInit) {
    this.localDescription = description;
    return Promise.resolve();
  }

  close() {
    this.signalingState = "closed";
  }
}

const broker = ws.link("wss://0.peerjs.com/peerjs");
const server = setupServer(
  broker.addEventListener("connection", ({ client }) => {
    client.send(JSON.stringify({ type: "OPEN" }));
    /* The main screen's answer to the station's join request: no endpoint, connect directly. */
    client.addEventListener("message", (event) => {
      const m = JSON.parse(String(event.data));
      if (m.type !== "OFFER" || m.payload?.type !== "gonogo-endpoint") return;
      client.send(
        JSON.stringify({
          type: "OFFER",
          src: m.dst,
          payload: {
            type: "gonogo-endpoint",
            connectionId: m.payload.connectionId,
            signal: { kind: "direct" },
          },
        }),
      );
    });
  }),
);

beforeAll(() => server.listen());
afterEach(() => {
  recorded.length = 0;
  vi.unstubAllGlobals();
});
afterAll(() => server.close());

describe("station to host data channel", () => {
  it("opens the channel ordered, as PeerJS's reliable mode", async () => {
    vi.stubGlobal("RTCPeerConnection", RecordingPeerConnection);
    vi.resetModules();
    const { PeerClientService } = await import("../peer/PeerClientService");

    /* PeerJS's own `_PEERJSTEST` support probe, created at module load. */
    recorded.length = 0;

    const svc = new PeerClientService();
    svc.connect("ABCD");
    try {
      /* The endpoint link's channel comes first, then PeerJS's once the main screen says to connect directly. */
      await vi.waitFor(() => expect(recorded).toHaveLength(2));
      for (const channel of recorded) {
        expect(channel.init).toEqual({ ordered: true });
      }
      const direct = recorded.find((c) => c.label !== "gonogo");
      const peer = await svc.waitForPeer();
      /* `Peer.connections` is typed `Object`; at runtime it maps peer id to that peer's connections. */
      const connections = peer.connections as Record<string, DataConnection[]>;
      const [conn] = connections["gonogo-host-ABCD"] ?? [];
      expect(conn).toMatchObject({ label: direct?.label, reliable: true });
    } finally {
      svc.disconnect();
    }
  });

  it("logs under the broker id it opened with, so the host's lines about it join", async () => {
    vi.stubGlobal("RTCPeerConnection", RecordingPeerConnection);
    vi.resetModules();
    const { PeerClientService } = await import("../peer/PeerClientService");
    const { logger } = await import("@ksp-gonogo/logger");

    const svc = new PeerClientService();
    svc.connect("ABCD");
    try {
      const peer = await svc.waitForPeer();
      expect(logger.getIdentity().peerId).toBe(peer.id);
    } finally {
      svc.disconnect();
    }
  });
});
