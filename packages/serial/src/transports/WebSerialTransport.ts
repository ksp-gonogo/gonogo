import { logger } from "@gonogo/logger";
import { parseCharPosition } from "../parsers/charPosition";
import { parseJsonState } from "../parsers/jsonState";
import type { DeviceType } from "../types";
import type {
  DeviceTransport,
  InputEvent,
  SchemaUpdate,
  TransportStatus,
} from "./DeviceTransport";

const trace = logger.tag("serial:transport");
const parserTrace = logger.tag("serial:parser");

interface WebSerialTransportOptions {
  id: string;
  deviceType: DeviceType;
  baudRate?: number;
  filters?: SerialPortFilter[];
}

/**
 * Opens a `navigator.serial` port for a single device instance, reads
 * newline-delimited lines, runs the configured parser against each one,
 * and emits `InputEvent`s upstream. Frames written via `write()` are
 * pushed straight to the port (no padding — padding is the render
 * style's job).
 */
export class WebSerialTransport implements DeviceTransport {
  readonly id: string;
  status: TransportStatus = "disconnected";

  private deviceType: DeviceType;
  private baudRate: number;
  private filters?: SerialPortFilter[];

  private port: SerialPort | null = null;
  private reader: ReadableStreamDefaultReader<string> | null = null;
  private writer: WritableStreamDefaultWriter<string> | null = null;
  private readableClosed: Promise<void> | null = null;
  private writableClosed: Promise<void> | null = null;
  /**
   * AbortControllers passed to pipeTo so we can forcibly release the
   * locks pipeTo holds on `port.readable` / `port.writable`. Without
   * these, an unplugged device can leave session 1's pipeTo holding
   * those locks indefinitely (port.close() throws on a lost device,
   * so spec-driven release-on-close doesn't fire), and a session 2
   * doConnect on the recovered OS-open port then hits "Cannot pipe a
   * locked stream".
   */
  private readableAbort: AbortController | null = null;
  private writableAbort: AbortController | null = null;
  private buffer = "";

  private inputListeners = new Set<(event: InputEvent) => void>();
  private schemaListeners = new Set<(update: SchemaUpdate) => void>();
  private rawLineListeners = new Set<(line: string) => void>();
  private statusListeners = new Set<
    (status: TransportStatus, err?: unknown) => void
  >();

  /**
   * In-flight connect promise. Coalesces concurrent calls — autoReconnect
   * (StrictMode setup) and tryAdoptPort (hot-plug) can both fire connect()
   * for the same transport in quick succession, and Web Serial rejects the
   * second port.open() with "A call to open() is already in progress".
   * Coalescing means the second caller awaits the first's result instead of
   * starting a parallel open.
   */
  private connectingPromise: Promise<void> | null = null;

  constructor(opts: WebSerialTransportOptions) {
    this.id = opts.id;
    this.deviceType = opts.deviceType;
    this.baudRate = opts.baudRate ?? 9600;
    this.filters = opts.filters;
  }

  /**
   * Exposed so SerialDeviceService can persist the VID/PID after a successful
   * connect — auto-reconnect on the next load needs it to match against
   * `navigator.serial.getPorts()`.
   */
  getPortInfo(): { vendorId?: number; productId?: number } | null {
    const info = this.port?.getInfo();
    if (!info) return null;
    return { vendorId: info.usbVendorId, productId: info.usbProductId };
  }

  /**
   * Live SerialPort reference (or null when disconnected). The wizard's
   * collision check uses this to compare port identity directly — way
   * more reliable than VID/PID matching for boards that expose 0 or
   * undefined for one of them.
   */
  getPort(): SerialPort | null {
    return this.port;
  }

  /**
   * True while a connect() is in flight. The hot-plug listener uses
   * this to skip phantom 'connect' events that USB hubs sometimes
   * emit during an unplug.
   */
  isConnecting(): boolean {
    return this.connectingPromise !== null;
  }

  async connect(options?: { port?: SerialPort }): Promise<void> {
    if (this.connectingPromise) return this.connectingPromise;
    this.connectingPromise = this.doConnect(options).finally(() => {
      this.connectingPromise = null;
    });
    return this.connectingPromise;
  }

  /**
   * Try-close-then-open a port with backoff for "open in progress" /
   * "port already open" errors.
   *
   * After a hot-unplug Chrome can hold the same SerialPort instance in a
   * stuck "open in progress" state that survives even our explicit
   * close() — only a few hundred ms of dwell, or a page refresh, lets it
   * drain. A page refresh worked because the OS had ~time to settle by
   * the time autoReconnect fired; in-session replug had no such gap.
   *
   * Each attempt does close() (best-effort) then open(). InvalidStateError
   * triggers backoff and retry. Anything else throws immediately.
   */
  private async openWithRetry(port: SerialPort): Promise<void> {
    const delays = [0, 200, 500, 1000]; // ~1.7s total dwell budget
    let lastError: unknown;
    for (let i = 0; i < delays.length; i++) {
      if (delays[i] > 0) {
        trace.debug("open retry waiting", {
          deviceId: this.id,
          attempt: i + 1,
          delayMs: delays[i],
        });
        await new Promise((r) => setTimeout(r, delays[i]));
      }
      try {
        await port.close();
      } catch {
        // Port wasn't open in any meaningful sense — fine.
      }
      try {
        await port.open({
          baudRate: this.baudRate,
          dataBits: 8,
          stopBits: 1,
          parity: "none",
          flowControl: "none",
        });
        return;
      } catch (err) {
        lastError = err;
        const transient =
          err instanceof Error && err.name === "InvalidStateError";
        if (!transient) throw err;
        // The port can be open at OS level even though our await for
        // open() rejected — a previous in-progress open quietly resolved
        // and our explicit close() didn't tear it down. `port.readable`
        // and `port.writable` are non-null exactly when the port is
        // currently open. Treat that as success: doConnect will hook
        // streams off the existing open state instead of fighting it.
        if (port.readable !== null && port.writable !== null) {
          trace.debug("open recovered — port already open at OS level", {
            deviceId: this.id,
            attempt: i + 1,
          });
          return;
        }
        // else: loop and retry after backoff
      }
    }
    throw lastError;
  }

  private async doConnect(options?: { port?: SerialPort }): Promise<void> {
    try {
      // Defensive cleanup: a previous read-loop error or hot-unplug could
      // have left a stale port reference behind. Drop it before opening
      // anything new so we don't immediately hit "port already open".
      if (this.port) {
        const stale = this.port;
        this.port = null;
        try {
          await stale.close();
        } catch {
          // Stale port; closing failures are expected.
        }
      }
      const port =
        options?.port ??
        (await navigator.serial.requestPort({
          filters: this.filters,
        }));

      await this.openWithRetry(port);

      // pipeTo's lock release after AbortController.abort() is async —
      // poll briefly before declaring the streams unrecoverable.
      // Cleanup ran moments ago in tryAdoptPort's stale-connected
      // branch; the abort signal may still be propagating through
      // pipeTo's settle path here.
      const lockPollDelays = [0, 100, 250, 500, 1000];
      for (const delay of lockPollDelays) {
        if (delay > 0) {
          await new Promise((r) => setTimeout(r, delay));
        }
        if (!port.readable?.locked && !port.writable?.locked) break;
        trace.debug("waiting for stream locks to release", {
          deviceId: this.id,
          delayMs: delay,
        });
      }
      if (port.readable?.locked || port.writable?.locked) {
        // Still locked after ~1.85s. The OS port is in a state that
        // only a fresh JS context (page refresh) clears. The menu's
        // "Reset connection" button on the device row is the recovery
        // path; the message here makes that explicit.
        throw new Error(
          "Serial port streams are still locked from a prior session. Use Reset connection on the device row to refresh and recover.",
        );
      }

      this.port = port;

      const decoder = new TextDecoderStream();
      if (!port.readable || !port.writable) {
        throw new Error("Serial port missing readable/writable streams");
      }
      this.readableAbort = new AbortController();
      this.readableClosed = port.readable.pipeTo(decoder.writable, {
        signal: this.readableAbort.signal,
      });
      this.reader = decoder.readable.getReader();

      const encoder = new TextEncoderStream();
      this.writableAbort = new AbortController();
      this.writableClosed = encoder.readable.pipeTo(port.writable, {
        signal: this.writableAbort.signal,
      });
      this.writer = encoder.writable.getWriter();

      this.setStatus("connected");
      trace.debug("connected", {
        deviceId: this.id,
        baudRate: this.baudRate,
        parser: this.deviceType.parser,
        adoptedPort: !!options?.port,
      });
      void this.readLoop();
    } catch (err) {
      // InvalidStateError on open() is almost always a transient USB
      // condition: a phantom 'connect' event fired during an unplug,
      // an autoReconnect raced a still-resolving teardown, or the OS
      // has the port in an "open in progress" state we couldn't clear.
      // None of these are app bugs — log them quietly at warn, mark
      // the device as disconnected (not error) so the next legitimate
      // 'connect' event triggers a fresh adopt rather than skipping
      // this transport, and rethrow for the caller's own handling.
      const isTransient =
        err instanceof Error && err.name === "InvalidStateError";
      if (isTransient) {
        logger.warn(`[WebSerialTransport ${this.id}] open transient failure`, {
          err: err.message,
        });
        this.setStatus("disconnected", err);
      } else {
        logger.error(
          `[WebSerialTransport ${this.id}] connect failed`,
          err instanceof Error ? err : new Error(String(err)),
        );
        this.setStatus("error", err);
      }
      throw err;
    }
  }

  async disconnect(): Promise<void> {
    await this.cleanupTransport("disconnected");
  }

  /**
   * Shared cleanup path used by `disconnect()` and the read-loop's
   * error path. Each step runs independently so a single failure (e.g.
   * `reader.cancel()` rejecting on a hot-pulled device) doesn't abort
   * the rest of the teardown — without this, locks on `port.readable`
   * / `port.writable` from a now-dead session linger and a subsequent
   * doConnect (after openWithRetry recovers a still-OS-open port) hits
   * "Cannot pipe a locked stream" when it tries to set up new streams.
   */
  private async cleanupTransport(
    finalStatus: TransportStatus,
    err?: unknown,
  ): Promise<void> {
    // Abort the pipeTos first — that's what releases the locks on
    // port.readable / port.writable. reader.cancel + releaseLock alone
    // only release the decoder/encoder side; the locks pipeTo holds on
    // the SerialPort streams themselves only drop when pipeTo settles,
    // and on a lost device pipeTo can hang indefinitely if not aborted.
    this.readableAbort?.abort();
    this.readableAbort = null;
    this.writableAbort?.abort();
    this.writableAbort = null;

    try {
      await this.reader?.cancel();
    } catch {
      // expected on lost devices
    }
    try {
      this.reader?.releaseLock();
    } catch {
      // releaseLock throws if already released
    }
    this.reader = null;
    // Do NOT await readableClosed / writableClosed — their pipeTo promises
    // only resolve once the source/destination fully close, which for a
    // mock or a hard-pulled USB device may never happen. Drop the refs.
    this.readableClosed?.catch(() => {});
    this.readableClosed = null;

    try {
      this.writer?.releaseLock();
    } catch {
      // ditto
    }
    this.writer = null;
    this.writableClosed?.catch(() => {});
    this.writableClosed = null;

    const port = this.port;
    this.port = null;
    try {
      await port?.close();
    } catch {
      // Closing a lost port often throws; fine.
    }
    this.setStatus(finalStatus, err);
  }

  async write(data: string | Uint8Array): Promise<void> {
    if (!this.writer) return;
    const text =
      typeof data === "string" ? data : new TextDecoder().decode(data);
    await this.writer.write(text);
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

  onSchema(cb: (update: SchemaUpdate) => void): () => void {
    this.schemaListeners.add(cb);
    return () => {
      this.schemaListeners.delete(cb);
    };
  }

  onRawLine(cb: (line: string) => void): () => void {
    this.rawLineListeners.add(cb);
    return () => {
      this.rawLineListeners.delete(cb);
    };
  }

  updateDeviceType(type: DeviceType): void {
    this.deviceType = type;
  }

  private async readLoop(): Promise<void> {
    const reader = this.reader;
    if (!reader) return;
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        if (!value) continue;
        trace.debug("chunk read", {
          deviceId: this.id,
          length: value.length,
          preview: value.slice(0, 80),
        });
        this.buffer += value;
        const lines = this.buffer.split("\n");
        this.buffer = lines.pop() ?? "";
        for (const line of lines) this.handleLine(line);
      }
    } catch (err) {
      logger.error(
        `[WebSerialTransport ${this.id}] read loop error`,
        err instanceof Error ? err : new Error(String(err)),
      );
      // Run the same cleanup disconnect() does — crucially, this
      // includes reader.cancel() + releaseLock() so port.readable's
      // lock is freed. Without that, the port can stay OS-open after
      // unplug (close() throws on a lost device) and the next session's
      // openWithRetry → "port already open" recovery path picks it up
      // with locks still held, surfacing as "Cannot pipe a locked
      // stream" inside doConnect's stream setup.
      await this.cleanupTransport("error", err);
    }
  }

  private handleLine(line: string): void {
    // Notify raw-line subscribers first so the calibration wizard can show
    // exactly what the device is sending, even if the parser would discard
    // the line. Skip empty lines so the wizard's "latest" view doesn't
    // flicker through blanks at startup.
    if (line !== "") {
      trace.debug("line", {
        deviceId: this.id,
        line,
        rawListeners: this.rawLineListeners.size,
        inputListeners: this.inputListeners.size,
      });
      this.rawLineListeners.forEach((cb) => {
        cb(line);
      });
    }
    if (this.deviceType.parser === "char-position") {
      const events = parseCharPosition(line, this.deviceType.inputs);
      parserTrace.debug("char-position parsed", {
        deviceId: this.id,
        eventCount: events.length,
        inputCount: this.deviceType.inputs.length,
      });
      for (const event of events) {
        this.inputListeners.forEach((cb) => {
          cb(event);
        });
      }
      return;
    }
    if (this.deviceType.parser === "json-state") {
      const result = parseJsonState(line, this.deviceType.inputs);
      parserTrace.debug("json-state parsed", {
        deviceId: this.id,
        eventCount: result.events.length,
        inputsUpdate: result.inputsUpdate?.length ?? null,
        screenUpdate: result.screenUpdate ? "yes" : "no",
      });
      if (result.inputsUpdate || result.screenUpdate) {
        const update: SchemaUpdate = {
          inputs: result.inputsUpdate,
          screen: result.screenUpdate,
        };
        this.schemaListeners.forEach((cb) => {
          cb(update);
        });
      }
      for (const event of result.events) {
        this.inputListeners.forEach((cb) => {
          cb(event);
        });
      }
    }
  }

  private setStatus(status: TransportStatus, err?: unknown): void {
    this.status = status;
    this.statusListeners.forEach((cb) => {
      cb(status, err);
    });
  }
}
