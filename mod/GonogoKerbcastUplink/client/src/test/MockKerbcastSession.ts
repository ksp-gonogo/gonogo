import type {
  KerbcastDataChannel,
  KerbcastPeer,
  KerbcastTransport,
} from "@ksp-gonogo/kerbcast";

/**
 * Controllable in-process fake for kerbcast sidecar sessions.
 *
 * Prefer the SDK's `MockSidecar` (`@ksp-gonogo/kerbcast/testing`) — the
 * protocol-level canonical fake, which speaks the full wire protocol including
 * the dynamic slot subscription. The component tests (`CameraFeed`) and the
 * dynamic/broker `KerbcastDataSource` tests already use it.
 *
 * This transport-level fake remains for the handful of `KerbcastDataSource`
 * tests that assert data-source internals `MockSidecar` doesn't surface: the
 * captured `iceServers` (the relay-TURN threading path), the raw `sentMessages`
 * array (message ordering), and the `closed` flag. Those are a natural fit for
 * a transport fake; folding them into `MockSidecar` to delete this file is a
 * possible future cleanup, not a current need.
 */
export interface MockKerbcastSession {
  /** Pass to KerbcastDataSource or KerbcastClient constructor. */
  readonly transport: KerbcastTransport;
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
   *
   * Slot-aware (dynamic-mode) delivery and the subscribe → slot-map round-trip
   * live in the SDK's canonical `MockSidecar` (`@ksp-gonogo/kerbcast/testing`) —
   * use that for dynamic-subscription tests rather than extending this fake.
   */
  deliverTrack(track: MediaStreamTrack, idx?: number): void;
}

export function createMockKerbcastSession(): MockKerbcastSession {
  const _sentMessages: string[] = [];
  let _channelOpenHandler: (() => void) | undefined;
  let _messageHandler: ((raw: string) => void) | undefined;
  let _stateHandler:
    | ((s: "disconnected" | "connecting" | "connected" | "failed") => void)
    | undefined;
  let _trackHandler:
    | ((track: MediaStreamTrack, idx: number, mid: string) => void)
    | undefined;
  let _closed = false;
  let _iceServers: RTCIceServer[] | undefined;

  const channel: KerbcastDataChannel = {
    send: (s) => _sentMessages.push(s),
    onOpen: (h) => {
      _channelOpenHandler = h;
    },
    onMessage: (h) => {
      _messageHandler = h;
    },
    onClose: () => {},
  };

  const peer: KerbcastPeer = {
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

  const transport: KerbcastTransport = {
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
      // mid is unused in legacy index-routed mode (gonogo's current path);
      // pass the index as a placeholder mid for the 3-arg handler.
      _trackHandler?.(track, idx, String(idx));
    },
  };
}

/**
 * Build a URL-aware `fetch` implementation for kerbcast tests. The data source
 * makes two distinct calls on connect: a GET `/ice-config` (TURN creds) and
 * the SDK client's POST `/offer` (SDP answer + camera flightIds). A single
 * shared `Response` can't serve both — its body is consumed on the first read
 * — so this returns a *fresh* Response per call, routed by URL.
 *
 * Pass to `vi.spyOn(globalThis, "fetch").mockImplementation(kerbcastFetchImpl(...))`.
 * `iceServers` defaults to `[]` (the no-relay case → SDK STUN fallback);
 * pass servers to exercise the TURN path.
 */
export function kerbcastFetchImpl(opts?: {
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
