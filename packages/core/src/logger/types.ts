export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogContext {
  requestId?: string;
  userId?: string;
  service?: string;
  [key: string]: unknown;
}

export type DeviceRole = "host" | "station" | "unknown";

export interface DeviceIdentity {
  role: DeviceRole;
  /**
   * Stable per-device id. Host short id (4 chars) for hosts, stationKey
   * (UUID) for stations. Survives refresh; lets us correlate every log
   * line a device emits over time.
   */
  id?: string;
  /** Live broker peer id — fresh per session for stations, stable for hosts. */
  peerId?: string;
  /**
   * For stations: the host peer id they're trying to reach (or are connected
   * to). Lets a search like `device.role == "station" and device.hostPeerId
   * == "XK3F"` show every station in a session with that host.
   */
  hostPeerId?: string;
}

export interface LogEntry {
  level: LogLevel;
  message: string;
  timestamp: string;
  tag?: string;
  context?: LogContext;
  error?: { name: string; message: string; stack?: string };
  device?: DeviceIdentity;
  /**
   * Per page-load identifier so a remote query can group all entries from
   * a single tab session. Distinct from the persistent device id.
   */
  sessionId?: string;
}

export interface LogTransport {
  /**
   * Emit one or more log entries to the transport. Implementations MUST NOT
   * throw — log delivery failures must never crash the calling code path.
   */
  send(entries: readonly LogEntry[]): void;
  /**
   * Drain any buffered entries. Optional; called on best-effort during
   * page unload and from tests that need deterministic dispatch.
   */
  flush?(): Promise<void> | void;
}

export interface TaggedLogger {
  debug(message: string, context?: LogContext): void;
  info(message: string, context?: LogContext): void;
  warn(message: string, context?: LogContext): void;
  error(message: string, error?: Error, context?: LogContext): void;
}

export interface Logger {
  debug(message: string, context?: LogContext): void;
  info(message: string, context?: LogContext): void;
  warn(message: string, context?: LogContext): void;
  error(message: string, error?: Error, context?: LogContext): void;
  /** Returns a sub-logger whose entries are gated on the given tag. */
  tag(name: string): TaggedLogger;
}
