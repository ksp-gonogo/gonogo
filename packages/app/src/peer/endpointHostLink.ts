import { encodeFrames, FrameReader } from "./endpointFraming";
import { TypedListeners } from "./typedListeners";

type LinkEvents = {
  open: [];
  data: [data: unknown];
  close: [];
  error: [err: Error];
};

/**
 * A station's connection to the main screen through the relay's endpoint.
 * It has the shape the station uses for a PeerJS data connection (`peer`,
 * `open`, `send`, `on`, `close`, `peerConnection`), so the rest of the
 * station runs the same on either path.
 *
 * The offer is sent before ICE gathering finishes, and with no candidates:
 * a phone on mobile data may never report gathering complete, and the
 * endpoint learns the station's address from its first connectivity check.
 */
export class EndpointHostLink {
  open = false;
  readonly peerConnection: RTCPeerConnection;
  private readonly channel: RTCDataChannel;
  private readonly events = new TypedListeners<LinkEvents>();
  private readonly reader = new FrameReader();
  private closed = false;

  constructor(
    /** The main screen's broker peer id. */
    readonly peer: string,
    createPeerConnection: () => RTCPeerConnection = () =>
      new RTCPeerConnection({ iceServers: [] }),
  ) {
    this.peerConnection = createPeerConnection();
    this.channel = this.peerConnection.createDataChannel("gonogo", {
      ordered: true,
    });
    this.channel.binaryType = "arraybuffer";
    this.channel.addEventListener("open", () => {
      if (this.closed) return;
      this.open = true;
      this.events.emit("open");
    });
    this.channel.addEventListener("message", (event) => {
      if (!(event.data instanceof ArrayBuffer)) return;
      const message = this.reader.push(new Uint8Array(event.data));
      if (message !== undefined) this.events.emit("data", message);
    });
    this.channel.addEventListener("close", () => this.markClosed());
    this.channel.addEventListener("error", () =>
      this.events.emit("error", new Error("data channel error")),
    );
  }

  /** Called for every piece of a large message as it arrives. */
  set onPiece(cb: ((bytes: number) => void) | null) {
    this.reader.onPiece = cb;
  }

  on<E extends keyof LinkEvents>(
    event: E,
    cb: (...args: LinkEvents[E]) => void,
  ): void {
    this.events.on(event, cb);
  }

  /** The offer to send the main screen. */
  async createOffer(): Promise<string> {
    const offer = await this.peerConnection.createOffer();
    await this.peerConnection.setLocalDescription(offer);
    return this.peerConnection.localDescription?.sdp ?? offer.sdp ?? "";
  }

  /** Apply the endpoint's answer; the link opens once ICE and the data channel are up. */
  async accept(answer: string): Promise<void> {
    await this.peerConnection.setRemoteDescription({
      type: "answer",
      sdp: answer,
    });
  }

  send(message: unknown): void {
    if (!this.open) return;
    for (const frame of encodeFrames(message)) this.channel.send(frame);
  }

  close(): void {
    if (this.closed) return;
    try {
      this.channel.close();
      this.peerConnection.close();
    } catch {
      /* already closed */
    }
    this.markClosed();
  }

  private markClosed(): void {
    if (this.closed) return;
    this.closed = true;
    this.open = false;
    this.events.emit("close");
  }
}
