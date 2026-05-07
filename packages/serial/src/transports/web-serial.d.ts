// Minimal Web Serial ambient types — kept alongside the WebSerialTransport
// so the transport package ships the type surface it needs.

interface SerialPortFilter {
  usbVendorId?: number;
  usbProductId?: number;
}

interface SerialOptions {
  baudRate: number;
  dataBits?: number;
  stopBits?: number;
  parity?: "none" | "even" | "odd";
  flowControl?: "none" | "hardware";
}

interface SerialPort {
  open(options: SerialOptions): Promise<void>;
  close(): Promise<void>;
  readable: ReadableStream | null;
  writable: WritableStream | null;
  getInfo(): SerialPortInfo;
}

interface SerialPortInfo {
  usbVendorId?: number;
  usbProductId?: number;
}

/**
 * Per the Web Serial spec, `connect` and `disconnect` are plain Events
 * whose `target` is the SerialPort — there is NO `port` field on the
 * event itself. Earlier code in this repo read `evt.port`, which silently
 * worked in tests (the mock matched) but produced `undefined` from a real
 * browser, breaking hot-plug and crashing on disconnect.
 */
interface SerialConnectionEvent extends Event {
  readonly target: SerialPort;
}

interface Serial {
  requestPort(options?: { filters?: SerialPortFilter[] }): Promise<SerialPort>;
  getPorts?(): Promise<SerialPort[]>;
  addEventListener?(
    type: "connect" | "disconnect",
    listener: (event: SerialConnectionEvent) => void,
  ): void;
  removeEventListener?(
    type: "connect" | "disconnect",
    listener: (event: SerialConnectionEvent) => void,
  ): void;
}

interface Navigator {
  serial: Serial;
}
