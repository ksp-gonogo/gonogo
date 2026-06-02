import { LogRingBuffer, type PersistConfig } from "./ringBuffer.js";
import { tagRegistry } from "./tags.js";

const DEFAULT_PERSIST_KEY = "gonogo.logs.ringBuffer";

function defaultPersist(): PersistConfig | undefined {
  // Opt out under tests so the buffer doesn't bleed across cases.
  try {
    const env = (globalThis as { process?: { env?: Record<string, string> } })
      .process?.env;
    if (env?.NODE_ENV === "test") return undefined;
  } catch {
    // ignore env access failures
  }
  if (typeof globalThis.sessionStorage === "undefined") return undefined;
  return { key: DEFAULT_PERSIST_KEY };
}

import type {
  DeviceIdentity,
  LogContext,
  LogEntry,
  Logger,
  LogLevel,
  LogTransport,
  TaggedLogger,
} from "./types.js";

function generateSessionId(): string {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return crypto.randomUUID();
  }
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function defaultEnabled(): boolean {
  // Suppress output in test runs so unit + integration suites stay quiet.
  // Opt back in with `logger.setEnabled(true)` or the `GONOGO_LOG=1` env flag.
  try {
    const env = (globalThis as { process?: { env?: Record<string, string> } })
      .process?.env;
    if (env?.GONOGO_LOG === "1") return true;
    if (env?.NODE_ENV === "test") return false;
  } catch {
    // ignore env access failures
  }
  return true;
}

// Numeric ordering so a threshold check is a single comparison.
const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

function isLogLevel(v: string): v is LogLevel {
  return v === "debug" || v === "info" || v === "warn" || v === "error";
}

function defaultLevel(): LogLevel {
  // Browser: `localStorage.LOG_LEVEL = 'warn'` then reload.
  // Node:    `LOG_LEVEL=warn` in the env.
  try {
    const ls = (globalThis as { localStorage?: Storage }).localStorage;
    const fromLs = ls?.getItem("LOG_LEVEL");
    if (fromLs && isLogLevel(fromLs)) return fromLs;
  } catch {
    // ignore — localStorage may be unavailable in SSR / node
  }
  try {
    const env = (globalThis as { process?: { env?: Record<string, string> } })
      .process?.env;
    const fromEnv = env?.LOG_LEVEL;
    if (fromEnv && isLogLevel(fromEnv)) return fromEnv;
  } catch {
    // ignore
  }
  return "debug";
}

export class ConsoleLogger implements Logger {
  private enabled: boolean;
  private level: LogLevel;
  private readonly buffer: LogRingBuffer;
  private readonly transports: LogTransport[] = [];
  private identity: DeviceIdentity = { role: "unknown" };
  private readonly sessionId: string;

  constructor(opts?: {
    enabled?: boolean;
    level?: LogLevel;
    bufferCapacity?: number;
    /** Optional persistence config. Pass `null` to opt out of the default. */
    persist?: PersistConfig | null;
    /** Override the auto-generated per-page-load session id (tests). */
    sessionId?: string;
  }) {
    this.enabled = opts?.enabled ?? defaultEnabled();
    this.level = opts?.level ?? defaultLevel();
    const persist =
      opts?.persist === null ? undefined : (opts?.persist ?? defaultPersist());
    this.buffer = new LogRingBuffer(opts?.bufferCapacity, persist);
    this.sessionId = opts?.sessionId ?? generateSessionId();
  }

  /**
   * Register an additional sink (e.g. Axiom). Every emitted entry is fanned
   * out to every registered transport — the same set the ring buffer sees,
   * before tag-gate / level-floor filtering. Console output is unchanged.
   */
  addTransport(transport: LogTransport): void {
    this.transports.push(transport);
  }

  /**
   * Remove a previously-registered transport. Best-effort flush of any
   * buffered entries first so the removed sink (e.g. Axiom) doesn't drop
   * what it already holds. Idempotent — removing a transport that isn't
   * registered is a no-op. Used by the analytics-consent gate to detach
   * the Axiom sink the moment consent is revoked.
   */
  removeTransport(transport: LogTransport): void {
    const idx = this.transports.indexOf(transport);
    if (idx === -1) return;
    void transport.flush?.();
    this.transports.splice(idx, 1);
  }

  /** Number of currently-registered transports — used by the consent
   *  controller's tests to assert install/remove without reaching into
   *  the private array. */
  transportCount(): number {
    return this.transports.length;
  }

  /**
   * Merge identity fields into the device context attached to every
   * subsequent log entry. Call once at app start with `{role, id}` and
   * again as more becomes known (e.g. station learns its hostPeerId on
   * connect). Does NOT replay past entries.
   */
  setIdentity(identity: Partial<DeviceIdentity>): void {
    this.identity = { ...this.identity, ...identity };
  }

  getIdentity(): DeviceIdentity {
    return this.identity;
  }

  getSessionId(): string {
    return this.sessionId;
  }

  async flushTransports(): Promise<void> {
    await Promise.all(
      this.transports.map(async (t) => {
        try {
          await t.flush?.();
        } catch {
          // ignore — log delivery failures are never fatal
        }
      }),
    );
  }

  setEnabled(value: boolean): void {
    this.enabled = value;
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  setLevel(level: LogLevel): void {
    this.level = level;
  }

  getLevel(): LogLevel {
    return this.level;
  }

  /** Snapshot of the in-memory ring buffer (oldest first). */
  getBuffer(): readonly LogEntry[] {
    return this.buffer.snapshot();
  }

  /**
   * Snapshot of the in-memory ring buffer (oldest first). Alias of
   * {@link getBuffer} — used by {@link AxiomConsentController} to backfill
   * the pre-consent history to a freshly-installed transport.
   */
  snapshot(): readonly LogEntry[] {
    return this.buffer.snapshot();
  }

  /** Serialises the buffer as a pretty-printed JSON array for download. */
  exportLogs(): string {
    return JSON.stringify(this.buffer.snapshot(), null, 2);
  }

  clearBuffer(): void {
    this.buffer.clear();
  }

  tag(name: string): TaggedLogger {
    return {
      debug: (message, context) =>
        this.emit("debug", message, context, undefined, name),
      info: (message, context) =>
        this.emit("info", message, context, undefined, name),
      warn: (message, context) =>
        this.emit("warn", message, context, undefined, name),
      error: (message, error, context) =>
        this.emit("error", message, context, error, name),
    };
  }

  debug(message: string, context?: LogContext) {
    this.emit("debug", message, context);
  }

  info(message: string, context?: LogContext) {
    this.emit("info", message, context);
  }

  warn(message: string, context?: LogContext) {
    this.emit("warn", message, context);
  }

  error(message: string, error?: Error, context?: LogContext) {
    this.emit("error", message, context, error);
  }

  private emit(
    level: LogLevel,
    message: string,
    context: LogContext | undefined,
    error?: Error,
    tag?: string,
  ) {
    if (!this.enabled) return;

    const entry: LogEntry = {
      level,
      message: tag ? `[${tag}] ${message}` : message,
      timestamp: new Date().toISOString(),
      tag,
      context,
      error: error
        ? { name: error.name, message: error.message, stack: error.stack }
        : undefined,
      device: this.identity,
      sessionId: this.sessionId,
    };

    // Buffer first — the export is intentionally richer than the console
    // stream so an operator can download the full trail after-the-fact
    // and inspect tag-gated / level-floored entries they didn't pre-enable.
    this.buffer.push(entry);

    // Transports get the same firehose as the buffer — pre-tag-gate,
    // pre-level-floor. Remote sinks are most useful when they catch the
    // long tail nobody pre-enabled locally; with 3–4 users the volume
    // is trivial.
    for (const transport of this.transports) {
      try {
        transport.send([entry]);
      } catch {
        // ignore — log delivery failures are never fatal
      }
    }

    // Console gating starts here. Tag-gated debug only prints if the tag
    // is enabled; info/warn/error from a tagged logger always print
    // (tags are opt-in verbose tracing, not a way to hide ops messages).
    if (tag && level === "debug" && !tagRegistry.isEnabled(tag)) return;

    // Level floor — same idea, console-only. Buffer keeps everything.
    if (LEVEL_ORDER[level] < LEVEL_ORDER[this.level]) return;

    const output = JSON.stringify(entry);
    switch (level) {
      case "debug":
      case "info":
        console.log(output);
        break;
      case "warn":
        console.warn(output);
        break;
      case "error":
        console.error(output);
        break;
    }
  }
}

export const logger = new ConsoleLogger();
export { AppError } from "./AppError.js";
export { AxiomConsentController } from "./AxiomConsentController.js";
export type { AxiomTransportOptions } from "./AxiomTransport.js";
export { AxiomTransport } from "./AxiomTransport.js";
export { LogRingBuffer } from "./ringBuffer.js";
export { tagRegistry } from "./tags.js";
export type {
  DeviceIdentity,
  DeviceRole,
  LogEntry,
  LogTransport,
  TaggedLogger,
} from "./types.js";

/**
 * Back-compat wrapper around the new tag system. `debugPeer("foo", ctx)`
 * behaves the same as `logger.tag("peer").debug("foo", ctx)` but stays
 * honouring the legacy `DEBUG_PEER=1` flag so existing docs still work.
 */
const peerLogger = logger.tag("peer");
export function debugPeer(message: string, context?: LogContext) {
  peerLogger.debug(message, context);
}

import { handleError as genericHandleError } from "./error-handler.js";
export function handleError(error: unknown) {
  genericHandleError(error, logger);
}
