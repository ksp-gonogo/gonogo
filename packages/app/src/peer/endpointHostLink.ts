import { FramedLink } from "./framedLink";

/**
 * A station's connection to the main screen through the relay's endpoint,
 * with the shape the station uses for a PeerJS data connection plus the
 * `peerConnection` its ICE diagnostics watch, so the rest of the station runs
 * the same on either path.
 *
 * The offer is sent before ICE gathering finishes, and with no candidates:
 * a phone on mobile data may never report gathering complete, and the
 * endpoint learns the station's address from its first connectivity check.
 */
export class EndpointHostLink extends FramedLink {
  readonly peerConnection: RTCPeerConnection;
  private readonly channel: RTCDataChannel;

  constructor(
    /** The main screen's broker peer id. */
    peer: string,
  ) {
    super(peer);
    this.peerConnection = new RTCPeerConnection({ iceServers: [] });
    this.channel = this.peerConnection.createDataChannel("gonogo", {
      ordered: true,
    });
    this.channel.binaryType = "arraybuffer";
    this.channel.addEventListener("open", () => this.opened());
    this.channel.addEventListener("message", (event) => {
      if (event.data instanceof ArrayBuffer) {
        this.received(new Uint8Array(event.data));
      }
    });
    this.channel.addEventListener("close", () => this.finished());
    this.channel.addEventListener("error", () =>
      this.failed(new Error("data channel error")),
    );
  }

  /** Called for every piece of a large message as it arrives. */
  set onPiece(cb: ((bytes: number) => void) | null) {
    this.reader.onPiece = cb;
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

  close(): void {
    if (this.isEnded) return;
    try {
      this.channel.close();
      this.peerConnection.close();
    } catch {
      /* already closed */
    }
    this.finished();
  }

  protected sendFrame(frame: Uint8Array<ArrayBuffer>): void {
    this.channel.send(frame);
  }
}
