/**
 * `navigator.serial` test double modelled on `@serialport/binding-mock`.
 *
 * The idea: the consuming code (WebSerialTransport) calls
 * `navigator.serial.requestPort()` / `port.open()` / reads from `port.readable`
 * / writes to `port.writable` exactly as it would against a real browser.
 * Tests install the mock once, create one or more ports, and drive bytes in
 * via `emitData()` / read bytes out via `drainWritten()`.
 *
 * Unlike node-serialport there's no pluggable binding layer in the Web Serial
 * API, so we monkey-patch `globalThis.navigator.serial` while the mock is
 * installed. `restore()` puts the original back.
 */

// ---------------------------------------------------------------------------
// Port
// ---------------------------------------------------------------------------

interface MockPortOptions {
  /** Returned by `getInfo()`. Defaults to `{}`. */
  info?: SerialPortInfo;
}

export class MockSerialPort implements SerialPort {
  private info: SerialPortInfo;

  // deviceToHost: bytes the "device" sends go in, the transport reads out.
  private deviceToHost = new TransformStream<Uint8Array, Uint8Array>();
  private deviceWriter = this.deviceToHost.writable.getWriter();

  // hostToDevice: bytes the transport writes go in, we collect them for tests.
  private hostToDevice = new TransformStream<Uint8Array, Uint8Array>();
  private hostReader = this.hostToDevice.readable.getReader();
  private written: Uint8Array[] = [];

  readable: ReadableStream<Uint8Array>;
  writable: WritableStream<Uint8Array>;

  constructor(opts: MockPortOptions = {}) {
    this.info = opts.info ?? {};
    this.readable = this.deviceToHost.readable;
    this.writable = this.hostToDevice.writable;
    void this.drainLoop();
  }

  open(_options: SerialOptions): Promise<void> {
    return Promise.resolve();
  }

  close(): Promise<void> {
    return Promise.resolve();
  }

  getInfo(): SerialPortInfo {
    return this.info;
  }

  // ---- Test-side API ------------------------------------------------------

  /** Push bytes "from the device" upstream to the transport. */
  async emitData(data: string | Uint8Array): Promise<void> {
    const bytes =
      typeof data === "string" ? new TextEncoder().encode(data) : data;
    await this.deviceWriter.write(bytes);
  }

  /** All frames the transport has written so far (sync snapshot). */
  drainWritten(): Uint8Array[] {
    const out = this.written.slice();
    this.written = [];
    return out;
  }

  /** Concatenated text view of all frames written so far. */
  drainWrittenText(): string {
    const frames = this.drainWritten();
    const decoder = new TextDecoder();
    return frames.map((b) => decoder.decode(b)).join("");
  }

  private async drainLoop(): Promise<void> {
    try {
      while (true) {
        const { value, done } = await this.hostReader.read();
        if (done) break;
        if (value) this.written.push(value);
      }
    } catch {
      // Transport closed; ignore.
    }
  }
}

// ---------------------------------------------------------------------------
// Serial
// ---------------------------------------------------------------------------

interface InstallOptions {
  /** Replace an existing navigator.serial if one is present. Default true. */
  force?: boolean;
}

type SerialEventListener = (event: SerialConnectionEvent) => void;

interface SerialLike {
  requestPort(options?: { filters?: SerialPortFilter[] }): Promise<SerialPort>;
  getPorts(): Promise<SerialPort[]>;
  addEventListener(
    type: "connect" | "disconnect",
    listener: SerialEventListener,
  ): void;
  removeEventListener(
    type: "connect" | "disconnect",
    listener: SerialEventListener,
  ): void;
}

export class MockWebSerial {
  private ports: MockSerialPort[] = [];
  private queue: MockSerialPort[] = [];
  private previous: unknown = undefined;
  private installed = false;
  private connectListeners = new Set<SerialEventListener>();
  private disconnectListeners = new Set<SerialEventListener>();

  /** Install a mock `navigator.serial`. */
  install(opts: InstallOptions = {}): void {
    if (!globalThis.navigator) {
      globalThis.navigator = {} as Navigator;
    }
    const nav = globalThis.navigator;
    if ("serial" in nav && !opts.force) return;
    this.previous = (nav as { serial?: unknown }).serial;
    (nav as unknown as { serial: SerialLike }).serial = {
      requestPort: async () => {
        const next = this.queue.shift();
        if (!next) throw new Error("MockWebSerial: no port available");
        return next;
      },
      getPorts: async () => this.ports.slice(),
      addEventListener: (type, listener) => {
        if (type === "connect") this.connectListeners.add(listener);
        else this.disconnectListeners.add(listener);
      },
      removeEventListener: (type, listener) => {
        if (type === "connect") this.connectListeners.delete(listener);
        else this.disconnectListeners.delete(listener);
      },
    };
    this.installed = true;
  }

  /** Fire a synthetic 'connect' event for a previously-created port. */
  fireConnect(port: MockSerialPort): void {
    const evt = { port } as unknown as SerialConnectionEvent;
    for (const cb of Array.from(this.connectListeners)) cb(evt);
  }

  /** Fire a synthetic 'disconnect' event for a previously-created port. */
  fireDisconnect(port: MockSerialPort): void {
    const evt = { port } as unknown as SerialConnectionEvent;
    for (const cb of Array.from(this.disconnectListeners)) cb(evt);
  }

  /** Restore the original `navigator.serial` (or delete it). */
  restore(): void {
    if (!this.installed) return;
    const nav = globalThis.navigator as unknown as {
      serial?: unknown;
    };
    if (this.previous === undefined) delete nav.serial;
    else nav.serial = this.previous;
    this.installed = false;
    this.ports = [];
    this.queue = [];
    this.connectListeners.clear();
    this.disconnectListeners.clear();
  }

  /**
   * Queue a port to be returned by the next `navigator.serial.requestPort()`.
   * Returns the port so the test can drive it.
   */
  createPort(opts?: MockPortOptions): MockSerialPort {
    const port = new MockSerialPort(opts);
    this.ports.push(port);
    this.queue.push(port);
    return port;
  }

  /** All ports created during this test. */
  getAll(): MockSerialPort[] {
    return this.ports.slice();
  }

  /** Reset queue + port list without uninstalling. */
  reset(): void {
    this.ports = [];
    this.queue = [];
  }
}
