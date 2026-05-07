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
  private buffer = "";

  private inputListeners = new Set<(event: InputEvent) => void>();
  private schemaListeners = new Set<(update: SchemaUpdate) => void>();
  private rawLineListeners = new Set<(line: string) => void>();
  private statusListeners = new Set<
    (status: TransportStatus, err?: unknown) => void
  >();

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

  async connect(options?: { port?: SerialPort }): Promise<void> {
    try {
      const port =
        options?.port ??
        (await navigator.serial.requestPort({
          filters: this.filters,
        }));
      await port.open({
        baudRate: this.baudRate,
        dataBits: 8,
        stopBits: 1,
        parity: "none",
        flowControl: "none",
      });
      this.port = port;

      const decoder = new TextDecoderStream();
      if (!port.readable || !port.writable) {
        throw new Error("Serial port missing readable/writable streams");
      }
      this.readableClosed = port.readable.pipeTo(decoder.writable);
      this.reader = decoder.readable.getReader();

      const encoder = new TextEncoderStream();
      this.writableClosed = encoder.readable.pipeTo(port.writable);
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
      logger.error(
        `[WebSerialTransport ${this.id}] connect failed`,
        err instanceof Error ? err : new Error(String(err)),
      );
      this.setStatus("error", err);
      throw err;
    }
  }

  async disconnect(): Promise<void> {
    try {
      await this.reader?.cancel();
      this.reader?.releaseLock();
      this.reader = null;
      // Do NOT await readableClosed / writableClosed — their pipeTo promises
      // only resolve once the source/destination fully close, which for a
      // mock or a hard-pulled USB device may never happen. Drop the refs.
      this.readableClosed?.catch(() => {});
      this.readableClosed = null;

      this.writer?.releaseLock();
      this.writer = null;
      this.writableClosed?.catch(() => {});
      this.writableClosed = null;

      await this.port?.close();
      this.port = null;
    } finally {
      this.setStatus("disconnected");
    }
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
      this.setStatus("error", err);
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
