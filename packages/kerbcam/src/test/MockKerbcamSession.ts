import type {
  KerbcamDataChannel,
  KerbcamPeer,
  KerbcamTransport,
} from "@jonpepler/kerbcam";

/**
 * Controllable in-process fake for kerbcam sidecar sessions.
 *
 * Extracted from the duplicated `makeFakeTransport()` in
 * KerbcamDataSource.test.ts and ExpCameraFeed.test.tsx so all test
 * files share a single canonical mock.
 *
 * TODO: once the next @jonpepler/kerbcam release is published, migrate
 * gonogo tests to use `MockSidecar` from `@jonpepler/kerbcam/testing`
 * instead — it is the protocol-level canonical fake and already ships in
 * kerbcam commit d6103cd.
 */
export interface MockKerbcamSession {
  /** Pass to KerbcamDataSource or KerbcamClient constructor. */
  readonly transport: KerbcamTransport;
  /**
   * The ICE servers the last `transport.createPeer(...)` was called with —
   * lets tests assert the relay's TURN creds were threaded through to the
   * peer connection. `undefined` until the first connect builds a peer.
   */
  readonly iceServers: RTCIceServer[] | undefined;
  /**
   * Raw JSON strings sent by the client to the sidecar.
   * Array is mutable so tests can splice it (e.g. `sent.length = 0`
   * to discard the initial `hello` before asserting a command).
   */
  readonly sentMessages: string[];
  /** True after `peer.close()` has been called. */
  readonly closed: boolean;
  /**
   * Simulate the sidecar completing the WebRTC handshake — fires the
   * control channel's `onOpen` handler. Call this after `ds.connect()`
   * resolves.
   */
  openChannel(): void;
  /**
   * Drive the peer's connection-state handler. Use `"connected"` for
   * the happy path, `"failed"` to test reconnect logic.
   */
  setState(state: "disconnected" | "connecting" | "connected" | "failed"): void;
  /**
   * Deliver a `ServerMessage` from the sidecar into the client.
   * The object is JSON-serialised before delivery — pass plain objects,
   * not pre-serialised strings.
   */
  sendServerMessage(msg: object): void;
  /**
   * Fire the peer's `onTrack` handler with a real `MediaStreamTrack` —
   * the WebRTC video path the SDK turns into `camera.mediaStream`. jsdom
   * can't produce a track, so this is only useful in a real browser (the
   * render harness uses `canvas.captureStream()`). `idx` maps to the
   * camera order from the `/offer` answer's `cameras` array (default 0).
   */
  deliverTrack(track: MediaStreamTrack, idx?: number): void;
}

export function createMockKerbcamSession(): MockKerbcamSession {
  const _sentMessages: string[] = [];
  let _channelOpenHandler: (() => void) | undefined;
  let _messageHandler: ((raw: string) => void) | undefined;
  let _stateHandler:
    | ((s: "disconnected" | "connecting" | "connected" | "failed") => void)
    | undefined;
  let _trackHandler:
    | ((track: MediaStreamTrack, idx: number) => void)
    | undefined;
  let _closed = false;
  let _iceServers: RTCIceServer[] | undefined;

  const channel: KerbcamDataChannel = {
    send: (s) => _sentMessages.push(s),
    onOpen: (h) => {
      _channelOpenHandler = h;
    },
    onMessage: (h) => {
      _messageHandler = h;
    },
    onClose: () => {},
  };

  const peer: KerbcamPeer = {
    addRecvOnlyTransceiver: () => {},
    createDataChannel: () => channel,
    onTrack: (h) => {
      _trackHandler = h;
    },
    onStateChange: (h) => {
      _stateHandler = h;
    },
    createOffer: async () => "v=0\r\n",
    setLocalDescription: async () => {},
    setRemoteAnswer: async () => {},
    waitForIceComplete: async () => {},
    localSdp: () => "v=0\r\n",
    close: () => {
      _closed = true;
    },
  };

  const transport: KerbcamTransport = {
    createPeer: (iceServers) => {
      _iceServers = iceServers;
      return peer;
    },
  };

  return {
    transport,
    get iceServers() {
      return _iceServers;
    },
    get sentMessages() {
      return _sentMessages;
    },
    get closed() {
      return _closed;
    },
    openChannel() {
      _channelOpenHandler?.();
    },
    setState(s) {
      _stateHandler?.(s);
    },
    sendServerMessage(msg) {
      _messageHandler?.(JSON.stringify(msg));
    },
    deliverTrack(track, idx = 0) {
      _trackHandler?.(track, idx);
    },
  };
}

/**
 * Build a URL-aware `fetch` implementation for kerbcam tests. The data source
 * makes two distinct calls on connect: a GET `/ice-config` (TURN creds) and
 * the SDK client's POST `/offer` (SDP answer + camera flightIds). A single
 * shared `Response` can't serve both — its body is consumed on the first read
 * — so this returns a *fresh* Response per call, routed by URL.
 *
 * Pass to `vi.spyOn(globalThis, "fetch").mockImplementation(kerbcamFetchImpl(...))`.
 * `iceServers` defaults to `[]` (the no-relay case → SDK STUN fallback);
 * pass servers to exercise the TURN path.
 */
export function kerbcamFetchImpl(opts?: {
  cameras?: number[];
  iceServers?: RTCIceServer[];
}): (input: RequestInfo | URL) => Promise<Response> {
  const cameras = opts?.cameras ?? [];
  const iceServers = opts?.iceServers ?? [];
  return async (input) => {
    const url = String(input);
    if (url.includes("/ice-config")) {
      return new Response(JSON.stringify({ iceServers }), { status: 200 });
    }
    return new Response(JSON.stringify({ sdp: "answer-sdp", cameras }), {
      status: 200,
    });
  };
}
