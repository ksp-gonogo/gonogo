/**
 * MockKosTelnet — a fake WebSocket that speaks the same wire contract as the
 * real @gonogo/telnet-proxy `/kos` endpoint, plus enough of a kOS REPL
 * simulation to drive integration tests for the kOS compute data source.
 *
 * Usage:
 *   const mock = MockKosTelnet.install();
 *   mock.setCpus([{ number: 1, vesselName: "X", partType: "KAL9000", tagname: "datastream" }]);
 *   mock.registerScript("deltav", (args) => `[KOSDATA] dv=${args[0]}50 [/KOSDATA]`);
 *   // ... now run code under test that creates WebSockets to ws://.../kos ...
 *   MockKosTelnet.uninstall();
 *
 * Each WebSocket construction returns a new session. The mock starts each
 * session in "menu" mode, emits the CPU list, and waits for a numeric
 * selection. On valid selection it switches to "repl" mode and processes
 * input line-by-line.
 *
 * What the mock handles:
 *   - Menu rendering in the exact format parseKosMenu expects
 *   - CPU selection by number → enters REPL
 *   - RUN <name>(<args>). → calls the registered handler; handler output
 *     is emitted back to the socket
 *   - Unknown script names → kOS-ish error text
 *   - Manual emit of raw text / list-changed marker / close events
 *
 * What it does NOT handle:
 *   - Telnet IAC negotiation (the real proxy's system telnet binary does this;
 *     the browser always sees already-negotiated text)
 *   - Garbled-input-fix timing (proxy-side concern, invisible to data source)
 *   - kOS syntax parsing inside script args (raw text passed to handler)
 */

import type { KosCpu } from "../../dataSources/kos-menu-parser";

export interface MockScriptInvocation {
  script: string;
  rawArgs: string;
  args: string[];
  cpu: KosCpu;
}

export type MockScriptHandler = (
  invocation: MockScriptInvocation,
) => string | Promise<string>;

type Listener = (event: unknown) => void;

type Mode = "menu" | "repl" | "closed";

const REPL_PROMPT = "\nkOS>";

export class MockKosTelnet {
  // ──────────────────────────────────────────────────────────────────────
  // Install / uninstall
  // ──────────────────────────────────────────────────────────────────────

  private static active: MockKosTelnet | null = null;
  private static originalWebSocket: typeof globalThis.WebSocket | undefined;

  /** Install the mock as `globalThis.WebSocket`. Returns the mock instance. */
  static install(): MockKosTelnet {
    if (MockKosTelnet.active) {
      throw new Error(
        "MockKosTelnet is already installed. Call uninstall() first.",
      );
    }
    const instance = new MockKosTelnet();
    MockKosTelnet.originalWebSocket = globalThis.WebSocket;
    // Use a class, not a function/arrow — `new WebSocket(url)` in the code
    // under test requires a [[Construct]] slot, which arrow functions lack.
    class WebSocketProxy extends MockKosTelnetSocket {
      static readonly OPEN = MockKosTelnetSocket.OPEN;
      static readonly CLOSED = MockKosTelnetSocket.CLOSED;
      constructor(url: string | URL) {
        super(String(url), instance);
        instance.registerSocket(this);
      }
    }
    globalThis.WebSocket =
      WebSocketProxy as unknown as typeof globalThis.WebSocket;
    MockKosTelnet.active = instance;
    return instance;
  }

  static uninstall(): void {
    if (!MockKosTelnet.active) return;
    if (MockKosTelnet.originalWebSocket) {
      globalThis.WebSocket = MockKosTelnet.originalWebSocket;
    }
    MockKosTelnet.active = null;
    MockKosTelnet.originalWebSocket = undefined;
  }

  // ──────────────────────────────────────────────────────────────────────
  // Per-instance state (one MockKosTelnet = one proxy/server)
  // ──────────────────────────────────────────────────────────────────────

  private cpus: KosCpu[] = [
    {
      number: 1,
      vesselName: "Untitled Space Craft",
      partType: "KAL9000",
      tagname: "datastream",
    },
  ];
  private scripts = new Map<string, MockScriptHandler>();
  private sockets: MockKosTelnetSocket[] = [];
  private invocationLog: MockScriptInvocation[] = [];

  setCpus(cpus: KosCpu[]): void {
    this.cpus = cpus;
    // Any session currently in menu mode should re-render the new menu.
    for (const s of this.sockets) {
      if (s.mode === "menu") s.emitMenuText(this.renderMenu());
    }
  }

  registerScript(name: string, handler: MockScriptHandler): void {
    this.scripts.set(name, handler);
  }

  /** All sessions currently open on this server. */
  sessions(): MockKosTelnetSocket[] {
    return this.sockets.filter((s) => s.mode !== "closed");
  }

  /**
   * Invocations seen across all sessions, in order. Useful for asserting
   * "widget A ran before widget B" and args resolution.
   */
  invocations(): MockScriptInvocation[] {
    return [...this.invocationLog];
  }

  /**
   * Emit the list-changed marker on every live session — simulates a vessel
   * switch / new CPU attached mid-play.
   */
  emitListChanged(): void {
    for (const s of this.sessions()) {
      s.mode = "menu";
      s.emitRaw("\n--(List of CPU's has Changed)--\n");
      s.emitMenuText(this.renderMenu());
    }
  }

  // ──────────────────────────────────────────────────────────────────────
  // Socket registration (called by the WebSocketProxy constructor)
  // ──────────────────────────────────────────────────────────────────────

  registerSocket(socket: MockKosTelnetSocket): void {
    this.sockets.push(socket);
    // Open + menu on the next microtask, matching the real WebSocket timing.
    queueMicrotask(() => {
      socket.open();
      if (socket.mode === "menu") socket.emitMenuText(this.renderMenu());
    });
  }

  // Called by MockKosTelnetSocket when it parses a RUN line.
  handleRun(
    socket: MockKosTelnetSocket,
    script: string,
    rawArgs: string,
  ): void {
    if (!socket.attachedCpu) return;
    const args = splitArgs(rawArgs);
    const invocation: MockScriptInvocation = {
      script,
      rawArgs,
      args,
      cpu: socket.attachedCpu,
    };
    this.invocationLog.push(invocation);
    const handler = this.scripts.get(script);
    if (!handler) {
      socket.emitRaw(`Cannot open file '${script}'.${REPL_PROMPT} `);
      return;
    }
    const result = handler(invocation);
    void Promise.resolve(result).then((output) => {
      if (socket.mode !== "repl") return;
      socket.emitRaw(`${output}\n${REPL_PROMPT} `);
    });
  }

  handleSelection(socket: MockKosTelnetSocket, line: string): void {
    const n = Number.parseInt(line.trim(), 10);
    const cpu = this.cpus.find((c) => c.number === n);
    if (!cpu) return; // Invalid selection — real kOS would ignore it too.
    socket.attachedCpu = cpu;
    socket.mode = "repl";
    // Real kOS prints a multi-line banner ending in "Proceed." once the
    // REPL is ready. The data source uses that as its REPL-ready
    // sentinel, so emit it here to mirror production behaviour.
    socket.emitRaw(
      `\nAttached to CPU on [${cpu.tagname}].\nkOS Operating System\nKerboScript v1.5.1.0\n \nProceed.\n${REPL_PROMPT} `,
    );
  }

  private renderMenu(): string {
    const header = [
      "Terminal: type = XTERM-256COLOR, size = 80x24",
      "______________________________________________________________________",
      "                        Menu GUI   Other",
      "                        Pick Open Telnets  Vessel Name (CPU tagname)",
      "                        ---- ---- -------  --------------------------",
    ].join("\n");
    const rows = this.cpus
      .map(
        (c) =>
          `                         [${c.number}]   no    0     ${c.vesselName} (${c.partType}(${c.tagname}))`,
      )
      .join("\n");
    const footer = [
      "---------------------------------------------------------------------",
      "Choose a CPU to attach to by typing a selection number and pressing return/enter. Or enter [Q] to quit terminal server.",
      "",
      "(After attaching, you can (D)etach and return to this menu by pressing Control-D as the first character on a new command line.)",
      "---------------------------------------------------------------------",
      "",
    ].join("\n");
    return `${header}\n${rows}\n${footer}`;
  }
}

// ──────────────────────────────────────────────────────────────────────
// Per-session socket
// ──────────────────────────────────────────────────────────────────────

// Matches either form:
//   RUN scriptName(arg1, arg2).
//   RUNPATH("path/to/script.ks", arg1, arg2).
// The production data source emits RUNPATH; RUN is kept here for existing
// tests that exercise the bare-name form.
const RUN_RE = /^RUN\s+(\S+?)\s*\(([^)]*)\)\s*\.\s*$/i;
const RUNPATH_RE = /^RUNPATH\s*\(\s*"([^"]+)"\s*(?:,\s*(.*?))?\s*\)\s*\.\s*$/i;

export class MockKosTelnetSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;

  readyState: number = MockKosTelnetSocket.CONNECTING;
  mode: Mode = "menu";
  attachedCpu: KosCpu | null = null;
  readonly url: string;

  private readonly listeners = new Map<string, Set<Listener>>();
  private inputBuffer = "";
  private readonly server: MockKosTelnet;

  constructor(url: string, server: MockKosTelnet) {
    this.url = url;
    this.server = server;
  }

  open(): void {
    this.readyState = MockKosTelnetSocket.OPEN;
    this.fire("open", {});
  }

  addEventListener(type: string, cb: Listener): void {
    let bucket = this.listeners.get(type);
    if (!bucket) {
      bucket = new Set();
      this.listeners.set(type, bucket);
    }
    bucket.add(cb);
  }

  removeEventListener(type: string, cb: Listener): void {
    this.listeners.get(type)?.delete(cb);
  }

  send(raw: string): void {
    if (this.mode === "closed") return;
    this.inputBuffer += raw;
    // Process complete lines (terminated by \n or \r).
    let nl = this.inputBuffer.search(/\r?\n/);
    while (nl !== -1) {
      const line = this.inputBuffer.slice(0, nl);
      this.inputBuffer = this.inputBuffer.slice(
        nl + (this.inputBuffer[nl] === "\r" ? 2 : 1),
      );
      this.handleLine(line);
      nl = this.inputBuffer.search(/\r?\n/);
    }
  }

  close(): void {
    if (this.mode === "closed") return;
    this.mode = "closed";
    this.readyState = MockKosTelnetSocket.CLOSED;
    this.fire("close", {});
  }

  /** Test-side emit of raw text as if it came from kOS. */
  emitRaw(text: string): void {
    if (this.mode === "closed") return;
    this.fire("message", { data: text });
  }

  /** Emit the CPU menu (called by MockKosTelnet on open / list-changed). */
  emitMenuText(text: string): void {
    this.emitRaw(text);
  }

  private handleLine(line: string): void {
    if (this.mode === "menu") {
      // Mirror kOS's welcome-menu input loop: 0x08 (Ctrl-H) deletes the
      // previous char from the buffer (or no-ops if empty). The compute
      // data source prefixes selection sends with a backspace run to
      // clear stray contamination, and the mock has to honour that or
      // those tests would all fail with NaN parses.
      this.server.handleSelection(this, applyBackspaces(line));
      return;
    }
    if (this.mode === "repl") {
      const run = RUN_RE.exec(line);
      if (run) {
        this.server.handleRun(this, run[1], run[2]);
        return;
      }
      const runPath = RUNPATH_RE.exec(line);
      if (runPath) {
        this.server.handleRun(this, runPath[1], runPath[2] ?? "");
        return;
      }
      // Non-RUN lines at the REPL are ignored by the mock (real kOS would
      // interpret them as commands, but the compute data source only sends
      // RUN / RUNPATH; mirroring that keeps the mock honest).
    }
  }

  private fire(type: string, event: unknown): void {
    this.listeners.get(type)?.forEach((cb) => {
      cb(event);
    });
  }
}

// ──────────────────────────────────────────────────────────────────────
// Argument splitter
// ──────────────────────────────────────────────────────────────────────

/**
 * Apply ASCII backspaces (0x08) to a string, deleting the previous char
 * for each one. Matches kOS's welcome-menu DELETELEFT handling: a
 * backspace on an empty buffer is a no-op.
 */
function applyBackspaces(line: string): string {
  const chars: string[] = [];
  for (const ch of line) {
    if (ch === "\b") chars.pop();
    else chars.push(ch);
  }
  return chars.join("");
}

// Splits `a, "b, c", 3` into ["a", '"b, c"', "3"]. Good enough for tests —
// the real data source builds these with its own escaping, so the mock just
// has to round-trip what it sent.
function splitArgs(raw: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let inString = false;
  let current = "";
  for (const ch of raw) {
    if (ch === '"' && depth === 0) inString = !inString;
    if (!inString) {
      if (ch === "(" || ch === "[") depth++;
      else if (ch === ")" || ch === "]") depth--;
    }
    if (ch === "," && depth === 0 && !inString) {
      out.push(current.trim());
      current = "";
      continue;
    }
    current += ch;
  }
  if (current.trim() !== "" || out.length > 0) out.push(current.trim());
  return out;
}
