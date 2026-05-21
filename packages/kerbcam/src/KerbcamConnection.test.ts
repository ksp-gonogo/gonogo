import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  type ConnectionStatus,
  KerbcamConnection,
  type WebRtcDataChannel,
  type WebRtcPeer,
  type WebRtcTransport,
} from "./KerbcamConnection";

// In-memory WebRTC transport for tests. Captures the data channel +
// ontrack handlers + state-change handler so the test can fire them
// synchronously without a real peer connection.
function makeFakeTransport() {
  let peerHandlers: {
    dc?: ReturnType<typeof makeFakeChannel>;
    onTrack?: (t: MediaStreamTrack, idx: number) => void;
    onState?: (s: ConnectionStatus) => void;
    closed: boolean;
  } = { closed: false };

  function makeFakeChannel() {
    const sent: string[] = [];
    const channel: WebRtcDataChannel & {
      sent: string[];
      _open: () => void;
      _msg: (raw: string) => void;
      _close: () => void;
    } = {
      sent,
      send: (s) => sent.push(s),
      setOnOpen: (h) => {
        channel._open = h;
      },
      setOnMessage: (h) => {
        channel._msg = h;
      },
      setOnClose: (h) => {
        channel._close = h;
      },
      _open: () => {},
      _msg: () => {},
      _close: () => {},
    };
    return channel;
  }

  const transport: WebRtcTransport = {
    createPeer: () => {
      const peer: WebRtcPeer = {
        addTransceiver: () => {},
        createDataChannel: () => {
          const ch = makeFakeChannel();
          peerHandlers.dc = ch;
          return ch;
        },
        setOntrack: (h) => {
          peerHandlers.onTrack = h;
        },
        setOnConnectionStateChange: (h) => {
          peerHandlers.onState = h;
        },
        createOffer: async () => "v=0\r\n…fake-sdp…\r\n",
        setLocalDescription: async () => {},
        setRemoteAnswer: async () => {},
        waitForIceComplete: async () => {},
        localSdp: () => "v=0\r\n…fake-sdp…\r\n",
        close: () => {
          peerHandlers.closed = true;
        },
      };
      return peer;
    },
  };

  return { transport, peerHandlers };
}

describe("KerbcamConnection", () => {
  beforeEach(() => {
    // jsdom doesn't ship MediaStream by default — provide the bare
    // minimum the tests need.
    if (typeof MediaStream === "undefined") {
      // @ts-expect-error — augmenting globals for the test env
      globalThis.MediaStream = class FakeMediaStream {
        private _tracks: MediaStreamTrack[];
        constructor(tracks: MediaStreamTrack[] = []) {
          this._tracks = [...tracks];
        }
        getTracks() {
          return this._tracks;
        }
      };
    }
    // fetch mock — every test stubs its own response shape.
    if (typeof fetch === "undefined") {
      // @ts-expect-error — augmenting globals for the test env
      globalThis.fetch = vi.fn();
    }
  });

  it("starts disconnected, transitions through connecting → connected", async () => {
    const { transport, peerHandlers } = makeFakeTransport();
    const conn = new KerbcamConnection({ host: "h", port: 1 }, transport);
    expect(conn.getStatus()).toBe("disconnected");

    const statuses: ConnectionStatus[] = [];
    conn.onStatusChange((s) => statuses.push(s));

    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ sdp: "answer-sdp", cameras: [42] }), {
        status: 200,
      }),
    );

    await conn.connect([42]);

    // ICE complete + answer applied — sidecar will move peer state to
    // connected; emulate by firing the captured handler.
    peerHandlers.onState?.("connected");

    expect(statuses).toContain("connecting");
    expect(statuses).toContain("connected");
    expect(conn.getStatus()).toBe("connected");
  });

  it("emits a hello message as soon as the control channel opens", async () => {
    const { transport, peerHandlers } = makeFakeTransport();
    const conn = new KerbcamConnection({ host: "h", port: 1 }, transport);

    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ sdp: "answer-sdp", cameras: [] }), {
        status: 200,
      }),
    );

    await conn.connect([]);
    peerHandlers.dc?._open();

    expect(peerHandlers.dc?.sent).toContain(JSON.stringify({ type: "hello" }));
  });

  it("populates the camera registry from a camera-snapshot push", async () => {
    const { transport, peerHandlers } = makeFakeTransport();
    const conn = new KerbcamConnection({ host: "h", port: 1 }, transport);

    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ sdp: "answer-sdp", cameras: [] }), {
        status: 200,
      }),
    );

    let snapshots = 0;
    conn.onCamerasChange(() => snapshots++);

    await conn.connect([]);
    peerHandlers.dc?._open();
    peerHandlers.dc?._msg(
      JSON.stringify({
        type: "camera-snapshot",
        content: {
          cameras: [
            {
              flightId: 42,
              partName: "navCam1",
              partTitle: "NavCam",
              cameraName: "NavCam",
              vesselName: "Perf Test 1",
              layers: [],
              operatorLayers: [],
              renderWidth: 768,
              renderHeight: 768,
              operatorWidth: 768,
              operatorHeight: 768,
              supportsZoom: true,
              fov: 60,
              fovMin: 30,
              fovMax: 100,
              supportsPan: false,
              panYaw: 0,
              panPitch: 0,
              panYawMin: 0,
              panYawMax: 0,
              panPitchMin: 0,
              panPitchMax: 0,
              encoderBitrateBps: 1_500_000,
              targetBitrateBps: 0,
            },
          ],
        },
      }),
    );

    expect(snapshots).toBe(1);
    expect(conn.getCameras()).toHaveLength(1);
    expect(conn.getCameras()[0]?.partTitle).toBe("NavCam");
  });

  it("routes set-layers calls onto the control channel", async () => {
    const { transport, peerHandlers } = makeFakeTransport();
    const conn = new KerbcamConnection({ host: "h", port: 1 }, transport);

    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ sdp: "answer-sdp", cameras: [] }), {
        status: 200,
      }),
    );

    await conn.connect([]);
    peerHandlers.dc?._open();
    peerHandlers.dc!.sent.length = 0; // drop the hello

    conn.sendSetLayers(42, ["NEAR", "SCALED"]);

    expect(peerHandlers.dc?.sent[0]).toBe(
      JSON.stringify({
        type: "set-layers",
        content: { flightId: 42, layers: ["NEAR", "SCALED"] },
      }),
    );
  });

  it("disconnects cleanly and tears down the peer", async () => {
    const { transport, peerHandlers } = makeFakeTransport();
    const conn = new KerbcamConnection({ host: "h", port: 1 }, transport);

    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ sdp: "answer-sdp", cameras: [] }), {
        status: 200,
      }),
    );

    await conn.connect([]);
    conn.disconnect();

    expect(peerHandlers.closed).toBe(true);
    expect(conn.getStatus()).toBe("disconnected");
  });
});
