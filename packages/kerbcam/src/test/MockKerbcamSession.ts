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
}

export function createMockKerbcamSession(): MockKerbcamSession {
  const _sentMessages: string[] = [];
  let _channelOpenHandler: (() => void) | undefined;
  let _messageHandler: ((raw: string) => void) | undefined;
  let _stateHandler:
    | ((s: "disconnected" | "connecting" | "connected" | "failed") => void)
    | undefined;
  let _closed = false;

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
    onTrack: () => {},
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
    createPeer: () => peer,
  };

  return {
    transport,
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
  };
}
