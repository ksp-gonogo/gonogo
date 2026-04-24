import type {
  ConfigField,
  DataKey,
  DataSource,
  DataSourceStatus,
} from "@gonogo/core";
import { logger, registerDataSource } from "@gonogo/core";
import type { KosData, KosScriptArg } from "@gonogo/data";
import { parseKosData } from "@gonogo/data";
import { parseKosMenu, parseListChanged } from "./kos-menu-parser";

export type { KosScriptArg };

export interface KosComputeConfig extends Record<string, unknown> {
  /** Proxy host (our @gonogo/telnet-proxy server). */
  host: string;
  /** Proxy port. */
  port: number;
  /** kOS telnet host, as reached from the proxy. */
  kosHost: string;
  /** kOS telnet port. */
  kosPort: number;
}

const DEFAULT_CONFIG: KosComputeConfig = {
  host: "localhost",
  port: 3001,
  kosHost: "localhost",
  kosPort: 5410,
};
const STORAGE_KEY = "gonogo.datasource.kos-compute";

/** Milliseconds a single executeScript call will wait for its [KOSDATA] line. */
const DEFAULT_CALL_TIMEOUT_MS = 10_000;

interface SessionOptions {
  callTimeoutMs?: number;
}

export class KosComputeDataSource implements DataSource<KosComputeConfig> {
  id = "kos-compute";
  name = "kOS Compute";
  status: DataSourceStatus = "disconnected";
  // kOS runs on the vessel; comm blackouts surface as their own errors at
  // dispatch time, so this source is deliberately exempt from the buffering
  // signal-loss gate.
  affectedBySignalLoss = false;

  private cfg: KosComputeConfig;
  private readonly statusListeners = new Set<
    (status: DataSourceStatus) => void
  >();
  private readonly sessions = new Map<string, KosComputeSession>();
  private readonly callTimeoutMs: number;

  constructor(config?: KosComputeConfig, opts: SessionOptions = {}) {
    this.cfg = config ?? this.loadConfig();
    this.callTimeoutMs = opts.callTimeoutMs ?? DEFAULT_CALL_TIMEOUT_MS;
  }

  // ── DataSource surface ─────────────────────────────────────────────────

  connect(): Promise<void> {
    // Sessions open lazily per-CPU on first executeScript. connect() exists
    // purely to satisfy the DataSource interface.
    return Promise.resolve();
  }

  disconnect(): void {
    for (const s of this.sessions.values()) s.close();
    this.sessions.clear();
    this.setStatus("disconnected");
  }

  schema(): DataKey[] {
    return [];
  }

  subscribe(): () => void {
    return () => {};
  }

  onStatusChange(cb: (status: DataSourceStatus) => void): () => void {
    this.statusListeners.add(cb);
    return () => this.statusListeners.delete(cb);
  }

  async execute(): Promise<void> {
    // Widgets use executeScript(cpu, script, args) directly via the hook.
    // The generic execute(action) channel doesn't carry enough structure.
    throw new Error(
      "KosComputeDataSource.execute is not supported; use executeScript instead",
    );
  }

  setupInstructions(): string {
    return "The kOS proxy bridges telnet to WebSocket. Run it locally:\n\n  podman compose up -d\n\n(or: docker compose up -d)\n\nfrom the gonogo project root.";
  }

  configSchema(): ConfigField[] {
    return [
      {
        key: "host",
        label: "Proxy Host",
        type: "text",
        placeholder: "localhost",
      },
      { key: "port", label: "Proxy Port", type: "number", placeholder: "3001" },
      {
        key: "kosHost",
        label: "kOS Host",
        type: "text",
        placeholder: "localhost",
      },
      {
        key: "kosPort",
        label: "kOS Port",
        type: "number",
        placeholder: "5410",
      },
    ];
  }

  getConfig(): KosComputeConfig {
    return { ...this.cfg };
  }

  configure(config: Record<string, unknown>): void {
    this.cfg = {
      host: typeof config.host === "string" ? config.host : this.cfg.host,
      port:
        typeof config.port === "number"
          ? config.port
          : Number(config.port) || this.cfg.port,
      kosHost:
        typeof config.kosHost === "string" ? config.kosHost : this.cfg.kosHost,
      kosPort:
        typeof config.kosPort === "number"
          ? config.kosPort
          : Number(config.kosPort) || this.cfg.kosPort,
    };
    this.saveConfig();
    // Config change invalidates all existing sessions — next executeScript
    // opens fresh ones against the new endpoint.
    this.disconnect();
  }

  // ── Public widget API ─────────────────────────────────────────────────

  /**
   * Run a script on the named CPU and resolve with its parsed [KOSDATA]
   * object. Calls to the same CPU are serialised by a per-session FIFO
   * queue; calls to different CPUs run in parallel. Rejects if no
   * [KOSDATA] arrives within the call timeout or the session dies.
   */
  executeScript(
    cpu: string,
    script: string,
    args: KosScriptArg[],
  ): Promise<KosData> {
    const session = this.getOrCreateSession(cpu);
    return session.enqueue(script, args);
  }

  // ── Internals ─────────────────────────────────────────────────────────

  private getOrCreateSession(cpu: string): KosComputeSession {
    let session = this.sessions.get(cpu);
    if (session) return session;
    session = new KosComputeSession({
      cpu,
      proxyHost: this.cfg.host,
      proxyPort: this.cfg.port,
      kosHost: this.cfg.kosHost,
      kosPort: this.cfg.kosPort,
      callTimeoutMs: this.callTimeoutMs,
      onStatusChange: () => this.recomputeStatus(),
    });
    this.sessions.set(cpu, session);
    this.recomputeStatus();
    return session;
  }

  private recomputeStatus(): void {
    if (this.sessions.size === 0) {
      this.setStatus("disconnected");
      return;
    }
    const states = [...this.sessions.values()].map((s) => s.status);
    if (states.some((s) => s === "connected")) {
      this.setStatus("connected");
    } else if (states.some((s) => s === "reconnecting")) {
      this.setStatus("reconnecting");
    } else {
      this.setStatus("disconnected");
    }
  }

  private setStatus(status: DataSourceStatus): void {
    if (status === this.status) return;
    this.status = status;
    this.statusListeners.forEach((cb) => {
      cb(status);
    });
  }

  private loadConfig(): KosComputeConfig {
    try {
      const stored = globalThis.localStorage?.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored) as Partial<KosComputeConfig>;
        return { ...DEFAULT_CONFIG, ...parsed };
      }
    } catch {
      /* ignore */
    }
    return { ...DEFAULT_CONFIG };
  }

  private saveConfig(): void {
    try {
      globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(this.cfg));
    } catch {
      /* localStorage unavailable */
    }
  }
}

// ---------------------------------------------------------------------------
// Per-CPU session
// ---------------------------------------------------------------------------

interface SessionInit {
  cpu: string;
  proxyHost: string;
  proxyPort: number;
  kosHost: string;
  kosPort: number;
  callTimeoutMs: number;
  onStatusChange: () => void;
}

interface PendingCall {
  script: string;
  args: KosScriptArg[];
  resolve: (data: KosData) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout> | null;
}

/**
 * Session state machine.
 *   - `menu`: kOS is showing the CPU selection menu. We wait for the
 *     menu-ready sentinel, match our configured tagname, send the
 *     numeric selection, and transition to `menu-selected`.
 *   - `menu-selected`: selection sent; waiting for kOS to finish
 *     booting the CPU's REPL before we dispatch anything else. kOS
 *     treats input received during this transition as still-on-menu
 *     input and flags it "Garbled selection", so we must not send
 *     the RUNPATH command until the REPL welcome marker arrives.
 *   - `repl`: ready to drain the queue.
 *   - `closed`: terminal state after `close()`.
 */
type SessionState = "menu" | "menu-selected" | "repl" | "closed";

export class KosComputeSession {
  status: DataSourceStatus = "disconnected";

  private readonly init: SessionInit;
  private ws: WebSocket | null = null;
  private state: SessionState = "menu";
  private menuBuffer = "";
  private replBuffer = "";
  private readonly queue: PendingCall[] = [];
  private inFlight: PendingCall | null = null;

  constructor(init: SessionInit) {
    this.init = init;
  }

  enqueue(script: string, args: KosScriptArg[]): Promise<KosData> {
    return new Promise<KosData>((resolve, reject) => {
      const call: PendingCall = { script, args, resolve, reject, timer: null };
      this.queue.push(call);
      this.ensureOpen();
      this.drain();
    });
  }

  close(): void {
    this.failAll(new Error("session closed"));
    try {
      this.ws?.close();
    } catch {
      /* already closed */
    }
    this.ws = null;
    this.state = "closed";
    this.setStatus("disconnected");
  }

  private ensureOpen(): void {
    if (this.ws && this.ws.readyState !== WebSocket.CLOSED) return;
    const url = `ws://${this.init.proxyHost}:${this.init.proxyPort}/kos?host=${encodeURIComponent(this.init.kosHost)}&port=${this.init.kosPort}`;
    const ws = new WebSocket(url);
    this.ws = ws;
    this.state = "menu";
    this.menuBuffer = "";
    this.replBuffer = "";
    this.setStatus("reconnecting");

    ws.addEventListener("open", () => {
      // Stays "reconnecting" until menu auto-select completes.
    });
    ws.addEventListener("message", (e) => {
      const text =
        typeof (e as MessageEvent).data === "string"
          ? (e as MessageEvent).data
          : String((e as MessageEvent).data);
      this.onMessage(text);
    });
    ws.addEventListener("close", () => {
      this.onClose();
    });
    ws.addEventListener("error", () => {
      logger.warn(`[kos-compute] websocket error on CPU=${this.init.cpu}`);
    });
  }

  private onMessage(text: string): void {
    if (this.state === "menu") {
      this.handleMenuText(text);
      return;
    }
    if (this.state === "menu-selected") {
      this.handleMenuSelectedText(text);
      return;
    }
    if (this.state === "repl") {
      this.handleReplText(text);
    }
  }

  /**
   * kOS prints the menu footer (the "Choose a CPU to attach to…"
   * instruction line) AFTER the last CPU row. Waiting for it is the
   * only reliable way to know the menu is fully rendered — parsing
   * `Vessel Name (CPU tagname)` plus one CPU row fires too early and
   * kOS rejects the selection with "Garbled selection. Try again."
   */
  private static readonly MENU_READY_SENTINEL =
    "Choose a CPU to attach to by typing a selection number";
  /** kOS prints this banner once a CPU has finished booting and the REPL
   *  is ready to accept commands. Without gating on it, the `RUNPATH`
   *  line arrives at kOS while the menu→REPL transition is still in
   *  flight and the command is swallowed as "Garbled selection". */
  private static readonly REPL_READY_SENTINEL = "Proceed.";
  /** Emitted by kOS when it didn't understand our selection input. */
  private static readonly MENU_GARBLED = "Garbled selection. Try again.";

  private handleMenuText(text: string): void {
    if (parseListChanged(text)) this.menuBuffer = "";
    this.menuBuffer += text;
    // Hold off until the whole menu has landed.
    if (!this.menuBuffer.includes(KosComputeSession.MENU_READY_SENTINEL)) {
      return;
    }
    const menu = parseKosMenu(this.menuBuffer);
    if (menu === null) return;
    const cpu = menu.cpus.find((c) => c.tagname === this.init.cpu);
    if (!cpu) return;
    // State transition BEFORE the send: some WS implementations (and
    // our mock telnet fixture) dispatch message events synchronously
    // from `.send()`, so kOS's reply lands while we're still inside
    // this call. If state were still "menu", onMessage would route
    // the attach output back to handleMenuText and send the selection
    // a second time.
    this.state = "menu-selected";
    this.menuBuffer = "";
    this.replBuffer = "";
    this.ws?.send(`${cpu.number}\n`);
    // Don't drain() here — the transition to "repl" + drain happens
    // when we see the REPL_READY_SENTINEL in handleMenuSelectedText.
  }

  /**
   * Buffer output until kOS prints the REPL welcome. Detects:
   *   - Proceed.  → transition to "repl" and drain the queue.
   *   - Garbled selection. Try again.  → the selection raced; back to
   *     the menu state and wait for the redraw.
   *   - --(List of CPU's has Changed)-- → CPU list mutated mid-transition.
   */
  private handleMenuSelectedText(text: string): void {
    if (parseListChanged(text)) {
      logger
        .tag("kos-compute")
        .warn("CPU list changed during menu→REPL transition", {
          cpu: this.init.cpu,
        });
      this.state = "menu";
      this.menuBuffer = text;
      return;
    }
    if (text.includes(KosComputeSession.MENU_GARBLED)) {
      logger
        .tag("kos-compute")
        .warn("selection garbled, re-entering menu state", {
          cpu: this.init.cpu,
        });
      this.state = "menu";
      this.menuBuffer = "";
      return;
    }
    // Accumulate in replBuffer so we can look for the REPL welcome
    // across chunk boundaries.
    this.replBuffer += text;
    if (this.replBuffer.includes(KosComputeSession.REPL_READY_SENTINEL)) {
      logger.tag("kos-compute").debug("REPL ready", { cpu: this.init.cpu });
      this.state = "repl";
      this.replBuffer = "";
      this.setStatus("connected");
      this.drain();
    }
  }

  private handleReplText(text: string): void {
    if (parseListChanged(text)) {
      // CPU list changed — we need to re-select. Active inFlight fails since
      // the REPL is gone.
      this.state = "menu";
      this.menuBuffer = text;
      this.replBuffer = "";
      this.setStatus("reconnecting");
      if (this.inFlight) {
        this.fail(this.inFlight, new Error("CPU list changed mid-call"));
        this.inFlight = null;
      }
      // Try to auto-select on the same chunk in case it carried the new menu.
      const menu = parseKosMenu(this.menuBuffer);
      if (menu !== null) this.handleMenuText("");
      return;
    }
    if (!this.inFlight) return;
    this.replBuffer += text;
    const data = parseKosData(this.replBuffer);
    if (data === null) return;
    const call = this.inFlight;
    this.inFlight = null;
    if (call.timer) clearTimeout(call.timer);
    call.resolve(data);
    this.replBuffer = "";
    this.drain();
  }

  private onClose(): void {
    this.failAll(new Error("session disconnected"));
    this.ws = null;
    this.state = "closed";
    this.setStatus("disconnected");
  }

  private drain(): void {
    if (this.state !== "repl") return;
    if (this.inFlight) return;
    const next = this.queue.shift();
    if (!next) return;
    this.inFlight = next;
    this.replBuffer = "";
    // RUNPATH accepts arbitrary paths (slashes, .ks extension) and is the
    // recommended form in current kOS. `RUN foo(...)` still works for a
    // bare filename but the parser chokes on paths like "boot/test.ks"
    // because the slash and dot aren't valid inside an identifier.
    const argList = [
      JSON.stringify(next.script),
      ...next.args.map(formatArg),
    ].join(", ");
    const cmd = `RUNPATH(${argList}).\n`;
    logger.tag("kos-compute").debug("dispatching", {
      cpu: this.init.cpu,
      script: next.script,
      args: next.args,
      cmd: cmd.trim(),
    });
    this.ws?.send(cmd);
    next.timer = setTimeout(() => {
      if (this.inFlight !== next) return;
      this.inFlight = null;
      // Dump what we did receive so the user can see why parseKosData
      // missed the marker — usually means the script errored before
      // emitting [KOSDATA], or the marker literal got mangled.
      logger.warn(
        `[kos-compute] script "${next.script}" timed out awaiting [KOSDATA]`,
        {
          cpu: this.init.cpu,
          bufferLen: this.replBuffer.length,
          bufferTail: this.replBuffer.slice(-1000),
        },
      );
      this.fail(
        next,
        new Error(`kOS script "${next.script}" timed out awaiting [KOSDATA]`),
      );
      // Move to the next queued call even though this one timed out — one
      // bad script shouldn't wedge the rest.
      this.drain();
    }, this.init.callTimeoutMs);
  }

  private fail(call: PendingCall, err: Error): void {
    if (call.timer) clearTimeout(call.timer);
    call.reject(err);
  }

  private failAll(err: Error): void {
    if (this.inFlight) {
      this.fail(this.inFlight, err);
      this.inFlight = null;
    }
    for (const call of this.queue.splice(0)) this.fail(call, err);
  }

  private setStatus(status: DataSourceStatus): void {
    if (status === this.status) return;
    this.status = status;
    this.init.onStatusChange();
  }
}

function formatArg(arg: KosScriptArg): string {
  if (typeof arg === "number") return String(arg);
  if (typeof arg === "boolean") return arg ? "true" : "false";
  // String — escape embedded quotes for kOS's double-quoted string literal.
  return `"${arg.replace(/"/g, '""')}"`;
}

registerDataSource(new KosComputeDataSource());
