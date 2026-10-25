import type { Packable } from "peerjs-js-binarypack";
import { encodeFrames, FrameReader } from "./endpointFraming";
import { TypedListeners } from "./typedListeners";

type LinkEvents = {
  open: [];
  data: [data: unknown];
  close: [];
  error: [err: Error];
};

/**
 * One end of a link through the relay's endpoint, in the shape the peer
 * layer uses for a PeerJS data connection (`peer`, `open`, `send`, `on`,
 * `close`). Messages go out as endpoint frames and are read back from them;
 * a subclass carries the frames and reports the link opening and ending.
 */
export abstract class FramedLink {
  open = false;
  protected readonly reader = new FrameReader();
  private readonly events = new TypedListeners<LinkEvents>();
  private ended = false;

  constructor(
    /** The broker peer id of the other end. */
    readonly peer: string,
  ) {}

  on<E extends keyof LinkEvents>(
    event: E,
    cb: (...args: LinkEvents[E]) => void,
  ): void {
    this.events.on(event, cb);
  }

  send(message: Packable): void {
    if (!this.open) return;
    for (const frame of encodeFrames(message)) this.sendFrame(frame);
  }

  abstract close(options?: { flush?: boolean }): void;

  protected abstract sendFrame(frame: Uint8Array<ArrayBuffer>): void;

  protected get isEnded(): boolean {
    return this.ended;
  }

  protected opened(): void {
    if (this.ended || this.open) return;
    this.open = true;
    this.events.emit("open");
  }

  protected received(frame: Uint8Array): void {
    if (!this.open) return;
    const message = this.reader.push(frame);
    if (message !== undefined) this.events.emit("data", message);
  }

  protected failed(err: Error): void {
    this.events.emit("error", err);
  }

  /** Reports the link ended, once, whichever end ended it. */
  protected finished(): void {
    if (this.ended) return;
    this.ended = true;
    this.open = false;
    this.events.emit("close");
  }
}
