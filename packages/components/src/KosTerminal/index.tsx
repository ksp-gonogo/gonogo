import type { ComponentProps } from "@gonogo/core";
import {
  getDataSource,
  registerComponent,
  safeRandomUuid,
  useKosProxy,
} from "@gonogo/core";
import { useReplayActive } from "@gonogo/data";
import { Panel, PanelTitle } from "@gonogo/ui";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import { useEffect, useReducer, useRef } from "react";
import styled from "styled-components";
import "@xterm/xterm/css/xterm.css";

interface KosTerminalConfig {
  /** When true, keystrokes are not forwarded to the PTY. */
  readOnly?: boolean;
  /**
   * Tagname of the CPU to auto-select when the kOS connection menu appears
   * (the inner part of the "(partType(tagname))" entry in the menu).
   * If omitted, the menu is presented interactively.
   */
  cpuName?: string;
}

// Matches a CPU row: " [1]   no    0     Vessel Name (KAL9000(tagname))"
// Groups: 1=number, 2=vesselName, 3=partType, 4=tagname
const CPU_ROW_RE = /\[(\d+)\]\s+\S+\s+\d+\s+(.+?)\s+\(([^(]+)\(([^)]+)\)\)/;
const LIST_CHANGED = "--(List of CPU's has Changed)--";
const MENU_HEADER = "Vessel Name (CPU tagname)";
const GARBLED_INPUT = "Garbled selection. Try again.";

/**
 * Text patterns that indicate the kOS side of the session has ended, even
 * though our WebSocket / peer tunnel may still be open. When we see one we
 * surface a disconnect to the user the same way a real `close` event would,
 * so terminals don't sit looking "live" when they're actually orphaned.
 */
const SESSION_END_SENTINELS: readonly string[] = [
  "Connection closed by foreign host",
  "Connection to localhost closed",
  "Connection to kos closed",
  "[connection closed]",
];

// ── Message-handler helpers ──────────────────────────────────────────────────
// Split out of the useEffect message handler so Sonar's cognitive-
// complexity (S3776) and nested-function-depth (S2004) rules stay
// satisfied. Each helper has a single, narrow responsibility.

interface MenuState {
  inMenuSelection: boolean;
  menuBuffer: string;
}

type TerminalLike = { writeln(line: string): void };
type WsLike = {
  readyState: number;
  send(data: string): void;
  close(): void;
};

/** Latches closed on the first sentinel match; subsequent calls are no-ops. */
function tryHandleSessionEnd(
  text: string,
  latch: { ended: boolean },
  term: TerminalLike,
  ws: WsLike,
): void {
  if (latch.ended) return;
  if (!SESSION_END_SENTINELS.some((s) => text.includes(s))) return;
  latch.ended = true;
  term.writeln("\r\n\x1b[33m[session ended]\x1b[0m");
  try {
    ws.close();
  } catch {
    // transport may already be closing; close() triggers the close handler
    // which shows [connection closed] as before.
  }
}

/**
 * Consumes the kOS CPU-selection menu and sends the numeric reply for the
 * configured tagname as soon as the menu is complete. Mutates `state` in
 * place so the useEffect's own closure can reset between frames.
 */
function tryAutoSelectCpu(
  text: string,
  cpuName: string,
  state: MenuState,
  ws: WsLike,
): void {
  // Garbled input: the proxy echoed our previous reply mid-redraw. Reset
  // and wait for the next clean menu frame.
  if (text.includes(GARBLED_INPUT)) {
    state.inMenuSelection = true;
    state.menuBuffer = "";
  }

  if (!state.inMenuSelection) return;
  if (text.includes(LIST_CHANGED)) state.menuBuffer = "";
  state.menuBuffer += text;
  if (!state.menuBuffer.includes(MENU_HEADER)) return;

  for (const line of state.menuBuffer.split("\n")) {
    const m = CPU_ROW_RE.exec(line);
    if (m?.[4] === cpuName) {
      if (ws.readyState === WebSocket.OPEN) ws.send(`${m[1]}\n`);
      state.inMenuSelection = false;
      state.menuBuffer = "";
      return;
    }
  }
}

/**
 * Fixed PTY width. We never send a width change to the proxy — width
 * changes during the kOS CPU menu (the most fragile moment in the
 * terminal's lifecycle) re-paint the menu and garble it, breaking both
 * the auto-select parser and manual readability. A comfortably wide
 * value dodges every line-wrap problem kOS can throw at us; the
 * in-widget xterm viewport is a window onto this wider PTY and clips
 * content that doesn't fit. Users break long commands with newlines
 * naturally, so it's rarely noticed in practice.
 */
const PTY_COLS = 80;
const MIN_REASONABLE_ROWS = 3;

/**
 * Read kOS endpoint live from the `kos` data source so every terminal widget
 * picks up config changes without a per-instance host field. The widget used
 * to bake `kosHost`/`kosPort` into its own config; that drifted whenever the
 * data source moved (e.g. localhost → LAN IP) and the cached widget config
 * pinned every fresh terminal at the stale value.
 */
function getKosEndpoint() {
  const kos = getDataSource("kos");
  if (!kos) return { kosHost: "localhost", kosPort: 5410 };
  const c = kos.getConfig();
  return {
    kosHost: typeof c.kosHost === "string" ? c.kosHost : "localhost",
    kosPort: typeof c.kosPort === "number" ? c.kosPort : 5410,
  };
}

function KosTerminalComponent(
  props: Readonly<ComponentProps<KosTerminalConfig>>,
) {
  // Outer guard. The terminal opens its own WebSocket directly to the kOS
  // proxy — bypassing the data-source registry entirely — so the
  // ReplayController's source swap can't intercept its traffic. During
  // replay, mount a placeholder instead so the user can't fire
  // commands at whatever live CPU happens to be reachable.
  //
  // Splitting the live body into a child component keeps the hooks order
  // inside it stable across mounts/unmounts (React rules of hooks).
  const replayActive = useReplayActive();
  if (replayActive) {
    return (
      <Panel>
        <PanelTitle>kOS TERMINAL</PanelTitle>
        <ReplayPlaceholder>Terminal disabled during replay.</ReplayPlaceholder>
      </Panel>
    );
  }
  return <KosTerminalLive {...props} />;
}

function KosTerminalLive({
  config,
}: Readonly<ComponentProps<KosTerminalConfig>>) {
  const { createConnection, resize } = useKosProxy();
  // Bump on every kos data source config change. The endpoint values below
  // are read fresh on each render, so a forced re-render is enough to
  // change the useEffect deps and tear down + reopen the ws.
  const [configEpoch, bumpConfigEpoch] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    const kos = getDataSource("kos") as
      | { onConfigChange?: (cb: () => void) => () => void }
      | undefined;
    return kos?.onConfigChange?.(bumpConfigEpoch);
  }, []);

  const { kosHost, kosPort } = getKosEndpoint();
  const readOnly = config?.readOnly ?? false;
  const cpuName = config?.cpuName;

  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  // configEpoch sits in the deps below as a deliberate trigger: when the
  // kos data source config changes, bumping it re-runs this effect, which
  // tears down the current ws and reopens against the fresh kosHost/kosPort.
  // The value isn't read in the body, which is why biome flags it.
  // biome-ignore lint/correctness/useExhaustiveDependencies: configEpoch is the trigger, not consumed
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // Fresh session id every time the effect runs — including reconnects
    // triggered by a kos config change, so the proxy treats this as a
    // brand-new pty rather than trying to resize a stale one.
    const sessionId = safeRandomUuid();
    let teardown: (() => void) | null = null;
    let cancelled = false;
    let sizeWaiter: ResizeObserver | null = null;
    let fallbackTimer: ReturnType<typeof setTimeout> | null = null;

    function runSetup() {
      if (cancelled || teardown || !container) return;
      sizeWaiter?.disconnect();
      sizeWaiter = null;
      if (fallbackTimer !== null) {
        clearTimeout(fallbackTimer);
        fallbackTimer = null;
      }

      const term = new Terminal({
        theme: {
          background: "var(--color-surface-panel)",
          foreground: "var(--color-text-primary)",
          cursor: "var(--color-accent-fg)",
          selectionBackground: "var(--color-status-go-bg)",
        },
        fontFamily: "monospace",
        fontSize: 13,
        cursorBlink: !readOnly,
      });
      const fitAddon = new FitAddon();
      term.loadAddon(fitAddon);
      term.open(container);

      // Fix the PTY width at PTY_COLS; only the row count tracks the
      // container. We use proposeDimensions() rather than fit() so the
      // first resize() call lands directly at (PTY_COLS, rows) — otherwise
      // fit() would resize to (proposedCols, rows) first, then we'd have
      // to correct to (PTY_COLS, rows), firing onResize twice.
      const proposed = fitAddon.proposeDimensions();
      const initialRows =
        proposed && proposed.rows >= MIN_REASONABLE_ROWS ? proposed.rows : 24;
      term.resize(PTY_COLS, initialRows);
      termRef.current = term;

      if (readOnly) {
        term.writeln("\x1b[2m[read-only]\x1b[0m");
      }

      // CPU auto-selection state — reset per effect instance
      const menuState: MenuState = {
        inMenuSelection: cpuName !== undefined,
        menuBuffer: "",
      };
      // Latch object so the helper can set `ended = true` through a
      // reference; primitives would not propagate back into the closure.
      const endLatch = { ended: false };

      const ws = createConnection({
        sessionId,
        kosHost,
        kosPort,
        cols: PTY_COLS,
        rows: initialRows,
      });
      wsRef.current = ws as unknown as WebSocket;

      ws.addEventListener("open", () => {
        term.writeln("\x1b[32mConnected to kOS proxy\x1b[0m");
      });

      ws.addEventListener("message", ({ data }) => {
        const text = typeof data === "string" ? data : String(data);
        term.write(text);
        // Close-sentinel check runs first — if we detect the session is
        // gone, auto-select is moot.
        tryHandleSessionEnd(text, endLatch, term, ws);
        if (cpuName !== undefined) {
          tryAutoSelectCpu(text, cpuName, menuState, ws);
        }
      });

      ws.addEventListener("close", () => {
        term.writeln("\r\n\x1b[33m[connection closed]\x1b[0m");
      });

      ws.addEventListener("error", () => {
        term.writeln("\r\n\x1b[31m[connection error]\x1b[0m");
      });

      // Terminal keystrokes → PTY (character-by-character, no buffering)
      if (!readOnly) {
        term.onData((data) => {
          if (ws.readyState === WebSocket.OPEN) ws.send(data);
        });
      }

      // Resize events → proxy (or PeerJS tunnel on stations). We always
      // send PTY_COLS for the width — the PTY width is immutable.
      term.onResize(({ rows }) => {
        if (ws.readyState !== WebSocket.OPEN) return;
        resize(sessionId, PTY_COLS, rows);
      });

      // Only the container's HEIGHT drives rows. Width stays pinned at
      // PTY_COLS, so horizontal container changes never trigger a NAWS
      // exchange that could interrupt menu rendering.
      const observer = new ResizeObserver(() => {
        const next = fitAddon.proposeDimensions();
        if (
          next &&
          next.rows >= MIN_REASONABLE_ROWS &&
          next.rows !== term.rows
        ) {
          term.resize(PTY_COLS, next.rows);
        }
      });
      observer.observe(container);

      teardown = () => {
        observer.disconnect();
        ws.close();
        term.dispose();
        wsRef.current = null;
        termRef.current = null;
      };
    }

    // Defer setup until the container has real layout dimensions. If we ran
    // immediately under react-grid-layout's 0×0 first paint, fit() would
    // return xterm's 2-column minimum; later when RGL sizes the cell we'd
    // fire an onResize that re-paints kOS and garbles the menu. Waiting
    // here means the PTY spawns at the correct size and the very next
    // onResize we send matches — kOS never sees a size change during the
    // initial menu exchange.
    const ready = () =>
      container.clientWidth >= 10 && container.clientHeight >= 10;

    if (ready()) {
      runSetup();
    } else {
      sizeWaiter = new ResizeObserver((entries) => {
        const entry = entries[0];
        const haveContentRect =
          entry &&
          entry.contentRect.width >= 10 &&
          entry.contentRect.height >= 10;
        if (haveContentRect || ready()) runSetup();
      });
      sizeWaiter.observe(container);
      // Safety net: if we somehow never observe a real size (mocked RO in
      // tests, container genuinely stays invisible), proceed anyway with
      // the default fallback dimensions baked into runSetup.
      fallbackTimer = setTimeout(runSetup, 500);
    }

    return () => {
      cancelled = true;
      sizeWaiter?.disconnect();
      if (fallbackTimer !== null) clearTimeout(fallbackTimer);
      teardown?.();
    };
    // Config values are primitives — re-run the effect if any change.
  }, [
    createConnection,
    resize,
    kosHost,
    kosPort,
    readOnly,
    cpuName,
    configEpoch,
  ]);

  return <Container ref={containerRef} $readOnly={readOnly} />;
}

registerComponent<KosTerminalConfig>({
  id: "kos-terminal",
  name: "kOS Terminal",
  description:
    "Interactive or read-only terminal connected to a kOS CPU via the telnet proxy.",
  tags: ["kos", "control", "telemetry"],
  defaultSize: { w: 18, h: 15 },
  minSize: { w: 8, h: 6 },
  openConfigOnAdd: true,
  component: KosTerminalComponent,
  dataRequirements: [],
  defaultConfig: {},
});

export { KosTerminalComponent };

const Container = styled.div<{ $readOnly?: boolean }>`
  width: 100%;
  height: 100%;
  background: var(--color-surface-panel);
  border: 1px solid ${({ $readOnly }) => ($readOnly ? "var(--color-status-info-bg)" : "var(--color-border-subtle)")};
  border-radius: 4px;
  overflow: hidden;
  box-sizing: border-box;

  /* xterm.js mounts a child div — make it fill the container */
  .xterm {
    height: 100%;
    padding: 8px;
  }
  .xterm-viewport {
    border-radius: 4px;
  }
`;

const ReplayPlaceholder = styled.div`
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  color: var(--color-text-faint);
  padding: 16px;
  text-align: center;
`;
