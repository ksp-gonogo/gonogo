import type {
  ConfigField,
  DataKey,
  DataSource,
  DataSourceStatus,
} from "@gonogo/core";
import { logger, PerfBudget, registerDataSource } from "@gonogo/core";
import type { KosData, KosScriptArg } from "@gonogo/data";
import { parseKosData, stripAnsi } from "@gonogo/data";
import { parseKosMenu, parseListChanged } from "./kos-menu-parser";

export type { KosScriptArg };

export interface KosConfig extends Record<string, unknown> {
  /** Proxy host (our @gonogo/telnet-proxy server). */
  host: string;
  /** Proxy port. */
  port: number;
  /** kOS telnet host, as reached from the proxy. */
  kosHost: string;
  /** kOS telnet port. */
  kosPort: number;
}

const DEFAULT_CONFIG: KosConfig = {
  host: "localhost",
  port: 3001,
  kosHost: "localhost",
  kosPort: 5410,
};
const STORAGE_KEY = "gonogo.datasource.kos";
/**
 * Pre-merge, executeScript() lived on a separate `kos-compute` source with
 * its own localStorage key. We still read it as a fallback so users who
 * configured kos-compute but never opened the kos config don't lose their
 * proxy/kOS endpoint when the merge lands. New writes go to STORAGE_KEY only.
 */
const LEGACY_KOS_COMPUTE_KEY = "gonogo.datasource.kos-compute";

/** Milliseconds a single executeScript call will wait for its [KOSDATA] line. */
const DEFAULT_CALL_TIMEOUT_MS = 10_000;

/**
 * Soft cap on kOS executeScript dispatch rate. Each script run holds a
 * CPU's REPL for ~hundreds of ms (RUNPATH + queue drain), so a sustained
 * dispatch rate above ~5/sec means widgets are stomping each other. At
 * 10/sec we want to know about it.
 */
const KOS_DISPATCH_BUDGET = new PerfBudget({
  name: "KosDataSource.executeScript dispatches/sec",
  threshold: 10,
  windowMs: 1000,
  unit: "dispatches",
});
/**
 * Default delay between detecting attach and draining the queue. Lets
 * kOS's Unity update loop detach the welcomeMenu so RUNPATH lands in the
 * CPU REPL and not the still-attached welcome menu input pump. Tests
 * override this to 0 since MockKosTelnet doesn't simulate the race.
 */
const DEFAULT_POST_ATTACH_DRAIN_DELAY_MS = 300;

interface KosDataSourceOptions {
  callTimeoutMs?: number;
  postAttachDrainDelayMs?: number;
}

/**
 * Single kOS data source: holds the proxy + kOS endpoint config, exposes
 * `executeScript(cpu, script, args)` for widgets that need to run kOS
 * scripts on individual CPUs, and notifies subscribers when the config
 * changes so live terminals can reconnect against the new endpoint.
 *
 * No persistent ws is held by this source. The KosTerminal widget opens
 * its own ws via `KosProxyContext`; per-CPU executeScript sessions open
 * lazily on demand and tear down when the source disconnects. This keeps
 * the proxy from holding a permanent telnet session that nothing reads.
 */
export class KosDataSource implements DataSource<KosConfig> {
  id = "kos";
  name = "kOS";
  status: DataSourceStatus = "disconnected";
  // kOS runs on the vessel; comm blackouts surface as their own errors at
  // dispatch time, so this source is deliberately exempt from the buffering
  // signal-loss gate.
  affectedBySignalLoss = false;

  private readonly statusListeners = new Set<
    (status: DataSourceStatus) => void
  >();
  private readonly configListeners = new Set<() => void>();
  private cfg: KosConfig;
  private readonly callTimeoutMs: number;
  private readonly postAttachDrainDelayMs: number;
  private remoteVersion: { version: string; buildTime: string } | null = null;
  private readonly remoteVersionListeners = new Set<
    (info: { version: string; buildTime: string } | null) => void
  >();
  private remoteVersionFetchInFlight = false;

  // Per-CPU executeScript sessions, keyed by tagname.
  private readonly sessions = new Map<string, KosComputeSession>();

  constructor(config?: KosConfig, opts: KosDataSourceOptions = {}) {
    this.cfg = config ?? this.loadConfig();
    this.callTimeoutMs = opts.callTimeoutMs ?? DEFAULT_CALL_TIMEOUT_MS;
    this.postAttachDrainDelayMs =
      opts.postAttachDrainDelayMs ?? DEFAULT_POST_ATTACH_DRAIN_DELAY_MS;
  }

  // --- Connection (no-op; sessions open lazily) ---

  connect(): Promise<void> {
    void this.refreshRemoteVersion();
    return Promise.resolve();
  }

  /**
   * One-shot HTTP probe of the proxy's `/version` endpoint. Stored on the
   * source for the DataSourceStatus widget to surface a per-source pill.
   * Errors are swallowed — an unreachable proxy already shows "disconnected"
   * via the per-session status; the version probe shouldn't add noise.
   */
  private async refreshRemoteVersion(): Promise<void> {
    if (this.remoteVersionFetchInFlight) return;
    this.remoteVersionFetchInFlight = true;
    try {
      const res = await fetch(
        `http://${this.cfg.host}:${this.cfg.port}/version`,
        { method: "GET" },
      );
      if (!res.ok) return;
      const body = (await res.json()) as {
        version?: string;
        buildTime?: string;
      };
      if (typeof body.version !== "string") return;
      const next = {
        version: body.version,
        buildTime: typeof body.buildTime === "string" ? body.buildTime : "",
      };
      const prev = this.remoteVersion;
      if (prev?.version === next.version && prev.buildTime === next.buildTime) {
        return;
      }
      this.remoteVersion = next;
      for (const cb of this.remoteVersionListeners) cb(next);
    } catch {
      /* proxy unreachable — handled by per-session status */
    } finally {
      this.remoteVersionFetchInFlight = false;
    }
  }

  getRemoteVersion(): { version: string; buildTime: string } | null {
    return this.remoteVersion;
  }

  onRemoteVersionChange(
    cb: (info: { version: string; buildTime: string } | null) => void,
  ): () => void {
    this.remoteVersionListeners.add(cb);
    return () => this.remoteVersionListeners.delete(cb);
  }

  disconnect(): void {
    for (const s of this.sessions.values()) s.close();
    this.sessions.clear();
    this.setStatus("disconnected");
  }

  // --- Data ---

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

  /**
   * Subscribe to config changes (host/port/kosHost/kosPort updates). The
   * callback fires every time `configure()` persists a new value. Used
   * by KosTerminal to drop and reopen its xterm session against the new
   * endpoint, otherwise an open terminal would stay pinned to whatever
   * host it connected against at mount.
   */
  onConfigChange(cb: () => void): () => void {
    this.configListeners.add(cb);
    return () => this.configListeners.delete(cb);
  }

  async execute(): Promise<void> {
    // Widgets use executeScript(cpu, script, args) directly via the hook.
    // The generic execute(action) channel doesn't carry enough structure.
    throw new Error(
      "KosDataSource.execute is not supported; use executeScript instead",
    );
  }

  setupInstructions(): string {
    return "The kOS proxy bridges telnet to WebSocket. Run it locally:\n\n  podman compose up -d\n\n(or: docker compose up -d)\n\nfrom the gonogo project root.";
  }

  // --- Public widget API ---

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
    KOS_DISPATCH_BUDGET.record();
    const session = this.getOrCreateSession(cpu);
    return session.enqueue(script, args);
  }

  // --- Config ---

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

  getConfig(): KosConfig {
    return {
      host: this.cfg.host,
      port: this.cfg.port,
      kosHost: this.cfg.kosHost,
      kosPort: this.cfg.kosPort,
    };
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
    // Tear down any open per-CPU sessions — they'd still be pointed at the
    // old endpoint. Next executeScript() will open fresh sessions against
    // the new config. Then notify config listeners (KosTerminal) so live
    // terminals reconnect too.
    for (const s of this.sessions.values()) s.close();
    this.sessions.clear();
    // Drop the cached proxy version — next /version probe runs against the
    // new endpoint.
    if (this.remoteVersion !== null) {
      this.remoteVersion = null;
      for (const cb of this.remoteVersionListeners) cb(null);
    }
    void this.refreshRemoteVersion();
    this.recomputeStatus();
    this.configListeners.forEach((cb) => {
      cb();
    });
  }

  private loadConfig(): KosConfig {
    const fromKos = readStoredPartial(STORAGE_KEY);
    const fromLegacy = readStoredPartial(LEGACY_KOS_COMPUTE_KEY);
    return { ...DEFAULT_CONFIG, ...fromLegacy, ...fromKos };
  }

  private saveConfig(): void {
    try {
      globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(this.cfg));
    } catch {
      /* localStorage unavailable */
    }
  }

  // --- executeScript session management ---

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
      postAttachDrainDelayMs: this.postAttachDrainDelayMs,
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

  // --- Status ---

  private setStatus(status: DataSourceStatus): void {
    if (status === this.status) return;
    this.status = status;
    this.statusListeners.forEach((cb) => {
      cb(status);
    });
  }
}

function readStoredPartial(key: string): Partial<KosConfig> {
  try {
    const stored = globalThis.localStorage?.getItem(key);
    if (!stored) return {};
    return JSON.parse(stored) as Partial<KosConfig>;
  } catch {
    return {};
  }
}

// ---------------------------------------------------------------------------
// Per-CPU executeScript session
// ---------------------------------------------------------------------------

interface SessionInit {
  cpu: string;
  proxyHost: string;
  proxyPort: number;
  kosHost: string;
  kosPort: number;
  callTimeoutMs: number;
  postAttachDrainDelayMs: number;
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
  /**
   * Fires if the menu→REPL transition stalls — kOS responded to our
   * selection but neither the REPL_READY_SENTINEL nor MENU_GARBLED ever
   * appeared. Without this, an in-flight call hangs forever (the
   * per-call timeout in drain() doesn't start until we reach REPL).
   */
  private attachTimer: ReturnType<typeof setTimeout> | null = null;
  /** How long we'll wait between sending the selection and seeing Proceed. */
  private static readonly ATTACH_TIMEOUT_MS = 5_000;

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
    this.clearAttachTimer();
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
    // rows is deliberately huge: this is a headless capture session, no
    // human ever looks at it. kOS's GUI terminal scrolls when output
    // overflows the visible row count, and the scrolling pushes the
    // [KOSDATA] opening tag past the top of the screen for any script
    // that prints more than ~24 lines (anything with a meaningful JSON
    // payload). At 10_000 rows there's no scrolling and we see the full
    // PRINT in the buffer regardless of payload size.
    //
    // cols stays at 80 — kOS only emits cursor-position escapes at row
    // boundaries, not within a line, so width doesn't affect parseability
    // and 80 keeps the wire bytes tiny.
    const url =
      `ws://${this.init.proxyHost}:${this.init.proxyPort}/kos` +
      `?host=${encodeURIComponent(this.init.kosHost)}` +
      `&port=${this.init.kosPort}` +
      `&cols=80&rows=10000`;
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
      logger.warn(`[kos] websocket error on CPU=${this.init.cpu}`);
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
  /**
   * Signals from kOS that we've attached to a CPU and the REPL is live:
   *   - `\x1b]2;…\x07`  — OSC SET TITLE that ConnectToProcessor sends as
   *     the first attach output (TelnetSingletonServer.SendTitleToTelnet).
   *   - `Proceed.`      — kept for the MockKosTelnet test fixture, which
   *     mirrors an older banner shape. Real kOS doesn't print this.
   *
   * NB: the OSC title is sent INSIDE ConnectToProcessor, but kOS's
   * welcomeMenu doesn't actually detach until a later Unity update tick
   * (TelnetSingletonServer.cs:607-615). If we drain RUNPATH the moment
   * we see the OSC title, the bytes still route through welcomeMenu and
   * get swallowed. POST_ATTACH_DRAIN_DELAY_MS gives kOS at least one
   * full Unity cycle to detach welcomeMenu before we send anything else.
   */
  private static readonly REPL_READY_OSC_TITLE_PREFIX = "\x1b]2;";
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
    // Snapshot what we acted on BEFORE clearing buffers — if kOS rejects
    // the selection with "Garbled selection. Try again." the post-clear
    // diagnostic in handleMenuSelectedText shows nothing useful, and we
    // need to know what menu we parsed and which row we picked.
    logger.tag("kos").debug("sending CPU selection", {
      cpu: this.init.cpu,
      selected: { number: cpu.number, tagname: cpu.tagname },
      cpus: menu.cpus.map((c) => ({
        number: c.number,
        tagname: c.tagname,
      })),
      menuBufferLen: this.menuBuffer.length,
      menuBufferTail: this.menuBuffer.slice(-500),
    });
    this.menuBuffer = "";
    this.replBuffer = "";
    // Prefix the selection with a backspace run to clear any stray bytes
    // that landed in kOS's localMenuBuffer between the menu print and our
    // send. We've observed kOS sending us 0x01/0x18 control bytes after
    // attach (terminal-feature noise from the proxy's telnet client) that
    // appear to also contaminate kOS's input buffer — int.TryParse on
    // `<garbage>1` fails and we get "Garbled selection. Try again."
    //
    // 0x08 (Ctrl-H) maps to DELETELEFT in the welcome-menu input loop;
    // it removes one char from localMenuBuffer or no-ops if empty, so
    // sending more than needed is safe. 16 covers any realistic noise.
    const clearPrefix = "\b".repeat(16);
    this.ws?.send(`${clearPrefix}${cpu.number}\n`);
    this.armAttachTimer();
    // Don't drain() here — the transition to "repl" + drain happens
    // when we see the REPL_READY_SENTINEL in handleMenuSelectedText.
  }

  private armAttachTimer(): void {
    this.clearAttachTimer();
    this.attachTimer = setTimeout(() => {
      this.attachTimer = null;
      // We selected a CPU but kOS never said "Proceed." or "Garbled".
      // Dump everything we received so we can see what its actual
      // response looks like — sentinel drift across kOS versions, a new
      // attach banner, or silence on the wire are all possibilities.
      logger.warn(`[kos] attach to CPU "${this.init.cpu}" timed out`, {
        cpu: this.init.cpu,
        state: this.state,
        replBufferLen: this.replBuffer.length,
        replBuffer: this.replBuffer.slice(-2000),
      });
      const call = this.inFlight;
      if (call) {
        this.inFlight = null;
        if (call.timer) clearTimeout(call.timer);
        this.fail(
          call,
          new Error(
            `kOS attach to CPU "${this.init.cpu}" timed out — see logs`,
          ),
        );
      }
      // Drop the session so the next executeScript opens a fresh one.
      // Whatever kOS-side state we're stuck in, a clean reconnect is
      // the only reliable recovery.
      try {
        this.ws?.close();
      } catch {
        /* already closed */
      }
      this.ws = null;
      this.state = "closed";
      this.setStatus("disconnected");
    }, KosComputeSession.ATTACH_TIMEOUT_MS);
  }

  private clearAttachTimer(): void {
    if (this.attachTimer !== null) {
      clearTimeout(this.attachTimer);
      this.attachTimer = null;
    }
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
      logger.tag("kos").warn("CPU list changed during menu→REPL transition", {
        cpu: this.init.cpu,
      });
      this.clearAttachTimer();
      this.state = "menu";
      this.menuBuffer = text;
      return;
    }
    if (text.includes(KosComputeSession.MENU_GARBLED)) {
      // Dump the buffered menu text + the chunk that triggered the garble.
      // Without this we have no signal on WHY kOS rejected the selection
      // (e.g. menu sentinel substring drifted between kOS versions, or a
      // CPU list change collided with our number send). Slice the tails
      // to keep log output bounded.
      logger.tag("kos").warn("selection garbled, re-entering menu state", {
        cpu: this.init.cpu,
        menuBufferTail: this.menuBuffer.slice(-1000),
        replBufferTail: this.replBuffer.slice(-1000),
        garbleChunk: text.slice(-500),
      });
      this.clearAttachTimer();
      this.state = "menu";
      this.menuBuffer = "";
      return;
    }
    // Accumulate in replBuffer so we can look for the attach signal
    // across chunk boundaries.
    this.replBuffer += text;
    if (
      this.replBuffer.includes(KosComputeSession.REPL_READY_OSC_TITLE_PREFIX) ||
      this.replBuffer.includes(KosComputeSession.REPL_READY_SENTINEL)
    ) {
      logger.tag("kos").debug("REPL ready (waiting for welcomeMenu detach)", {
        cpu: this.init.cpu,
      });
      this.clearAttachTimer();
      this.state = "repl";
      this.replBuffer = "";
      this.setStatus("connected");
      // Hold off the first drain so kOS's welcomeMenu has time to detach.
      // See REPL_READY_OSC_TITLE_PREFIX comment above.
      const drainAfter = () => {
        if (this.state !== "repl") return;
        // Drop any repaint bytes that landed during the settle window —
        // they're not [KOSDATA] and would only confuse the parser.
        this.replBuffer = "";
        this.drain();
      };
      if (this.init.postAttachDrainDelayMs > 0) {
        setTimeout(drainAfter, this.init.postAttachDrainDelayMs);
      } else {
        drainAfter();
      }
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
    // Debug: every byte we get in REPL state. Helps debug the case where
    // a script appears to run but we never see [KOSDATA] — tells us
    // whether RUNPATH reached the REPL (we'd see typed-line echo /
    // PRINT output) or got swallowed somewhere upstream.
    logger.tag("kos").debug("repl chunk", {
      cpu: this.init.cpu,
      script: this.inFlight.script,
      len: text.length,
      preview: text.slice(0, 200),
    });
    this.replBuffer += text;

    // Explicit script-author failure marker: [KOSERROR] message [/KOSERROR].
    // Checked first so it wins over [KOSDATA] if a script emits both —
    // e.g. when a script writes partial telemetry then explicitly aborts.
    const explicit = parseKosExplicitError(this.replBuffer);
    if (explicit !== null) {
      const call = this.inFlight;
      this.inFlight = null;
      if (call.timer) clearTimeout(call.timer);
      logger.tag("kos").info("kOS script raised an explicit error", {
        cpu: this.init.cpu,
        script: call.script,
        error: explicit,
      });
      this.fail(call, new Error(explicit));
      this.replBuffer = "";
      this.drain();
      return;
    }

    const data = parseKosData(this.replBuffer);
    if (data !== null) {
      const call = this.inFlight;
      this.inFlight = null;
      if (call.timer) clearTimeout(call.timer);
      call.resolve(data);
      this.replBuffer = "";
      this.drain();
      return;
    }

    const errorMsg = parseKosError(this.replBuffer);
    if (errorMsg !== null) {
      const call = this.inFlight;
      this.inFlight = null;
      if (call.timer) clearTimeout(call.timer);
      logger.tag("kos").warn("kOS error during script execution", {
        cpu: this.init.cpu,
        script: call.script,
        error: errorMsg,
      });
      this.fail(call, new Error(`kOS error: ${errorMsg}`));
      this.replBuffer = "";
      this.drain();
    }
  }

  private onClose(): void {
    this.clearAttachTimer();
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
    logger.tag("kos").debug("dispatching", {
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
        `[kos] script "${next.script}" timed out awaiting [KOSDATA]`,
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

/**
 * Match the explicit `[KOSERROR] message [/KOSERROR]` marker that script
 * authors can emit to deliberately fail a widget call with a domain-level
 * message (e.g. "engine flameout, abort burn"). Mirror of [KOSDATA]; the
 * inner text becomes the rejected promise's Error.message verbatim.
 */
function parseKosExplicitError(buffer: string): string | null {
  const m = /\[KOSERROR\]([\s\S]*?)\[\/KOSERROR\]/.exec(buffer);
  return m?.[1]?.trim() ?? null;
}

/**
 * Extract a useful one-line error message from a kOS REPL error block.
 * Returns null until enough of the error block has arrived to parse.
 *
 * kOS error blocks look like:
 *   <inline headline (may include extra echo lines)>
 *   ____________________________________________
 *              VERBOSE DESCRIPTION
 *   <verbose prose, sometimes including a Message: line>
 *   ____________________________________________
 *   <optional offending source line + carat>
 *   ____________________________________________
 *   At interpreter[, line N]
 *   <offending line>
 *           ^
 *
 * "At interpreter" is the consistent footer marker — once we see it, the
 * verbose section above is fully written, so we can safely extract.
 * Prefer the explicit `Message: …` line (TinyPG-style errors include one);
 * otherwise fall back to the first non-divider line after VERBOSE
 * DESCRIPTION (kOS-runtime errors, which restate the headline there).
 */
function parseKosError(buffer: string): string | null {
  // kOS draws the error block via cursor-position escapes rather than
  // newlines. Strip the ANSI noise and synthesise line breaks from the
  // CSI cursor moves so the line-by-line scan below works on real
  // terminal output (not just on the synthetic test fixtures that use
  // \n separators).
  const normalised = normaliseKosOutput(buffer);
  if (!normalised.includes("At interpreter")) return null;

  // Common kOS parse-time error: "<path> line:N col:M Not allowed to
  // SET … BUILTIN_FUNCTION called 'foo'". The VERBOSE-DESCRIPTION
  // section is empty for these, so match the headline directly.
  const clobberMatch =
    /Not allowed to SET[^\n]*?BUILTIN_FUNCTION called '([^']+)'/.exec(
      normalised,
    );
  if (clobberMatch?.[1]) {
    const lineCol = /line:(\d+)\s*col:(\d+)/.exec(normalised);
    const where = lineCol ? ` (line ${lineCol[1]}:${lineCol[2]})` : "";
    return `Cannot SET '${clobberMatch[1]}' — clobbers a kOS builtin${where}`;
  }

  // "Volume not found" / "File not found" / similar one-line errors that
  // appear in the buffer without a Message: line.
  const volumeMatch =
    /\b(Volume not found|File not found|Path not found)\b/.exec(normalised);
  if (volumeMatch?.[1]) return volumeMatch[1];

  const messageMatch = /\bMessage:\s*(.+)$/m.exec(normalised);
  if (messageMatch?.[1]) return messageMatch[1].trim();

  const lines = normalised.split("\n").map((l) => l.trim());
  const vdIdx = lines.findIndex((l) => l === "VERBOSE DESCRIPTION");
  if (vdIdx >= 0 && vdIdx + 1 < lines.length) {
    const candidate = lines[vdIdx + 1];
    if (candidate && !/^_{10,}$/.test(candidate)) return candidate;
  }
  return null;
}

/**
 * kOS terminal output uses CSI cursor-position escapes (`ESC[N;1H`) in
 * place of newlines for each rendered row. Convert those to `\n` so the
 * downstream regex / line-split logic finds boundaries, then strip any
 * remaining ANSI sequences.
 */
function normaliseKosOutput(buffer: string): string {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: parsing terminal output
  const withNewlines = buffer.replace(/\x1b\[\d+;\d+H/g, "\n");
  return stripAnsi(withNewlines);
}

registerDataSource(new KosDataSource());
