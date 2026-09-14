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
 * INSTALLED PeerJS hands to WebRTC rather than on the options we pass it.
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

  /* Never settles: the offer would go to a host that is not in this test. */
  createOffer() {
    return new Promise<RTCSessionDescriptionInit>(() => {});
  }

  close() {
    this.signalingState = "closed";
  }
}

const broker = ws.link("wss://0.peerjs.com/peerjs");
const server = setupServer(
  broker.addEventListener("connection", ({ client }) => {
    client.send(JSON.stringify({ type: "OPEN" }));
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
      await vi.waitFor(() => expect(recorded).toHaveLength(1));
      expect(recorded[0]?.init).toEqual({ ordered: true });
      const peer = await svc.waitForPeer();
      /* `Peer.connections` is typed `Object`; at runtime it maps peer id to that peer's connections. */
      const connections = peer.connections as Record<string, DataConnection[]>;
      const [conn] = connections["gonogo-host-ABCD"] ?? [];
      expect(conn).toMatchObject({ label: recorded[0]?.label, reliable: true });
    } finally {
      svc.disconnect();
    }
  });
});
