import type {
  DeviceTransport,
  InputEvent,
  TransportStatus,
} from "./DeviceTransport";

/**
 * In-memory transport for the virtual device widget and tests.
 * Always "connected"; input events come from `inject()` and the latest
 * rendered frame is exposed via `lastFrame` / `onFrame`.
 */
export class VirtualTransport implements DeviceTransport {
  readonly id: string;
  status: TransportStatus = "disconnected";
  lastFrame: string | Uint8Array | null = null;

  private inputListeners = new Set<(event: InputEvent) => void>();
  private statusListeners = new Set<
    (status: TransportStatus, err?: unknown) => void
  >();
  private frameListeners = new Set<(frame: string | Uint8Array) => void>();
  private rawLineListeners = new Set<(line: string) => void>();

  constructor(id: string) {
    this.id = id;
  }

  connect(): Promise<void> {
    this.setStatus("connected");
    return Promise.resolve();
  }

  disconnect(): Promise<void> {
    this.setStatus("disconnected");
    return Promise.resolve();
  }

  write(data: string | Uint8Array): Promise<void> {
    this.lastFrame = data;
    this.frameListeners.forEach((cb) => {
      cb(data);
    });
    return Promise.resolve();
  }

  onInput(cb: (event: InputEvent) => void): () => void {
    this.inputListeners.add(cb);
    return () => {
      this.inputListeners.delete(cb);
    };
  }

  onStatus(cb: (status: TransportStatus, err?: unknown) => void): () => void {
    this.statusListeners.add(cb);
    return () => {
      this.statusListeners.delete(cb);
    };
  }

  /** Subscribe to frames written via `write()`. */
  onFrame(cb: (frame: string | Uint8Array) => void): () => void {
    this.frameListeners.add(cb);
    return () => {
      this.frameListeners.delete(cb);
    };
  }

  /** Fire a synthetic input event. Used by the virtual widget and tests. */
  inject(inputId: string, value: boolean | number): void {
    this.inputListeners.forEach((cb) => {
      cb({ inputId, value });
    });
  }

  /** Subscribe to raw lines fed via `injectRawLine`. */
  onRawLine(cb: (line: string) => void): () => void {
    this.rawLineListeners.add(cb);
    return () => {
      this.rawLineListeners.delete(cb);
    };
  }

  /**
   * Fire a synthetic raw line so calibration-wizard tests can drive the
   * "live device" branch without touching navigator.serial.
   */
  injectRawLine(line: string): void {
    this.rawLineListeners.forEach((cb) => {
      cb(line);
    });
  }

  private setStatus(status: TransportStatus, err?: unknown): void {
    this.status = status;
    this.statusListeners.forEach((cb) => {
      cb(status, err);
    });
  }
}
