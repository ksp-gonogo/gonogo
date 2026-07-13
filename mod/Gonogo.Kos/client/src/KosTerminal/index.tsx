import type { ComponentProps, ConfigComponentProps } from "@ksp-gonogo/core";
import { registerComponent, safeRandomUuid } from "@ksp-gonogo/core";
import { useReplaySessionActive } from "@ksp-gonogo/data";
import {
  useCommand,
  useStream,
  useStreamEvent,
} from "@ksp-gonogo/sitrep-client";
import type {
  KosKeystrokeArgs,
  KosProcessorInfo,
  KosTerminalCloseArgs,
  KosTerminalFrame,
  KosTerminalOpenArgs,
  KosTerminalResizeArgs,
} from "@ksp-gonogo/sitrep-sdk";
import {
  ConfigForm,
  EmptyState,
  Field,
  FieldHint,
  FieldLabel,
  GhostButton,
  Input,
  Panel,
  PanelTitle,
  Switch,
  useModalSaveBar,
} from "@ksp-gonogo/ui";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import { useEffect, useMemo, useRef, useState } from "react";
import styled from "styled-components";
import "@xterm/xterm/css/xterm.css";

interface KosTerminalConfig {
  /** When true, keystrokes are not forwarded — a passive downlink viewer only. */
  readOnly?: boolean;
  /**
   * Tagname of the CPU to attach to. Resolved to a `coreId` against the live
   * `kos.processors` channel. If omitted and exactly one CPU is present it is
   * used automatically; with several CPUs and no tagname the widget shows an
   * in-widget picker.
   */
  cpuName?: string;
  /**
   * Line-mode composition. When on, the client composes a line locally with
   * instant echo and sends it as a single `kos.keystroke` command on Enter,
   * instead of one command per character. Under light-time delay a whole line
   * is one uplink round-trip instead of N. A per-terminal-instance toggle.
   */
  lineMode?: boolean;
}

const MIN_REASONABLE_ROWS = 3;

// ── CPU resolution ───────────────────────────────────────────────────────────

/**
 * Resolve the target CPU's `coreId` from the live processor list. An explicit
 * in-widget pick wins; then the configured tagname; then — only when a single
 * CPU exists — that sole CPU. Returns null when the choice is still ambiguous
 * or the named CPU has not appeared yet (the widget renders a picker / waiting
 * state accordingly).
 */
function resolveCoreId(
  processors: readonly KosProcessorInfo[],
  cpuName: string | undefined,
  picked: number | null,
): number | null {
  if (picked !== null && processors.some((p) => p.coreId === picked)) {
    return picked;
  }
  if (cpuName) {
    const match = processors.find((p) => p.tag === cpuName);
    return match ? match.coreId : null;
  }
  if (processors.length === 1) {
    return processors[0].coreId;
  }
  return null;
}

// ── Line-mode local composition ──────────────────────────────────────────────

type TermWriter = { write(data: string): void };

/**
 * Buffers a line client-side with instant echo into xterm and returns the
 * updated buffer. On Enter the whole line (+ `\r`) is flushed through
 * `sendChars` as one message; other printable chars echo and append; Backspace
 * edits locally. Pasted / multi-char input is processed char-by-char.
 *
 * The keystroke command rides the delayed uplink, so kOS ALSO echoes the
 * typed line into its own ScreenBuffer — that echo flows back over the
 * downlink and lands in the terminal a full round trip later. Left alone,
 * that means the line renders twice: once instantly here, once again from
 * the delayed echo. On Enter, instead of committing "\r\n" (which would
 * scroll the locally-echoed text into terminal history), this retracts the
 * local composition — return to column 0 and erase to end of line — so the
 * user still gets instant per-character feedback WHILE composing, but only
 * the server's later, authoritative echo ever becomes part of the
 * persisted terminal buffer.
 */
function handleLineModeChar(
  ch: string,
  buffer: string,
  term: TermWriter,
  sendChars: (chars: string) => void,
): string {
  if (ch === "\r" || ch === "\n") {
    sendChars(`${buffer}\r`);
    term.write("\r\x1b[K");
    return "";
  }
  if (ch === "\x7f" || ch === "\b") {
    if (buffer.length === 0) return buffer;
    term.write("\b \b");
    return buffer.slice(0, -1);
  }
  // biome-ignore lint/suspicious/noControlCharactersInRegex: matching C0 control range is the intent
  if (/[\x00-\x1f]/.test(ch)) return buffer;
  term.write(ch);
  return `${buffer}${ch}`;
}

function handleLineModeInput(
  data: string,
  buffer: string,
  term: TermWriter,
  sendChars: (chars: string) => void,
): string {
  let next = buffer;
  for (const ch of data) {
    next = handleLineModeChar(ch, next, term, sendChars);
  }
  return next;
}

// ── Component ─────────────────────────────────────────────────────────────────

function KosTerminalComponent(
  props: Readonly<ComponentProps<KosTerminalConfig>>,
) {
  // During a mission replay, mount a placeholder rather than a live terminal so
  // the operator can't fire keystrokes at whatever CPU happens to be reachable.
  // Splitting the live body out keeps its hook order stable across mounts.
  const replayActive = useReplaySessionActive();
  if (replayActive) {
    return (
      <Panel>
        <PanelTitle>kOS TERMINAL</PanelTitle>
        <EmptyState layout="fill">Terminal disabled during replay.</EmptyState>
      </Panel>
    );
  }
  return <KosTerminalLive {...props} />;
}

function KosTerminalLive({
  config,
}: Readonly<ComponentProps<KosTerminalConfig>>) {
  const readOnly = config?.readOnly ?? false;
  const cpuName = config?.cpuName;
  const lineMode = config?.lineMode ?? false;

  // Live CPU list from the mod's kos.processors channel (no telnet menu-scrape).
  const processors = useStream<KosProcessorInfo[]>("kos.processors") ?? [];
  const [pickedCoreId, setPickedCoreId] = useState<number | null>(null);
  const coreId = useMemo(
    () => resolveCoreId(processors, cpuName, pickedCoreId),
    [processors, cpuName, pickedCoreId],
  );

  // No CPU yet, or an ambiguous multi-CPU choice: show a status / picker rather
  // than an empty terminal. The live screen is a keyed child so switching CPUs
  // fully remounts it (fresh xterm + fresh lease) and its xterm effect runs on
  // mount, once a coreId exists.
  if (coreId === null) {
    return (
      <Panel>
        <PanelTitle>kOS TERMINAL</PanelTitle>
        {processors.length === 0 ? (
          <EmptyState layout="fill" role="status" aria-live="polite">
            {cpuName
              ? `Waiting for kOS CPU "${cpuName}"…`
              : "No kOS CPUs detected. Boot a kOS processor in-flight."}
          </EmptyState>
        ) : (
          <CpuPicker aria-label="Pick a kOS CPU">
            <CpuPicker__Label>Pick a CPU:</CpuPicker__Label>
            {processors.map((p) => (
              <GhostButton
                key={p.coreId}
                type="button"
                onClick={() => setPickedCoreId(p.coreId)}
              >
                {p.tag ?? `CPU ${p.coreId}`}
              </GhostButton>
            ))}
          </CpuPicker>
        )}
      </Panel>
    );
  }

  return (
    <KosTerminalScreen
      key={coreId}
      coreId={coreId}
      readOnly={readOnly}
      lineMode={lineMode}
    />
  );
}

interface KosTerminalScreenProps {
  coreId: number;
  readOnly: boolean;
  lineMode: boolean;
}

function KosTerminalScreen({
  coreId,
  readOnly,
  lineMode,
}: Readonly<KosTerminalScreenProps>) {
  // One opaque write-lease token per attach — the mod uses it to arbitrate the
  // single-owner shared screen. Keyed by coreId (via the parent), so a CPU
  // switch mints a fresh token with a clean open/close.
  const leaseTokenRef = useRef<string>("");
  if (leaseTokenRef.current === "") leaseTokenRef.current = safeRandomUuid();
  const leaseToken = leaseTokenRef.current;

  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  // The in-progress, not-yet-committed line-mode composition (typed since
  // the last Enter). Shared between the onData composition handler (inside
  // the xterm setup effect) and the downlink writer below, so a delayed
  // server echo that arrives mid-composition can retract it, write the
  // echo cleanly, and re-assert it — see the useStreamEvent handler.
  const lineBufferRef = useRef<string>("");

  // Uplink commands. Each `send` is a stable useCallback (keyed by command) —
  // destructured so effects can depend on it without the surrounding
  // per-render `{send,status}` object re-triggering them. The imperative xterm
  // handlers call the latest sender via refs.
  const { send: sendKeystroke } = useCommand("kos.keystroke");
  const { send: sendOpen } = useCommand("kos.terminal.open");
  const { send: sendClose } = useCommand("kos.terminal.close");
  const { send: sendResize } = useCommand("kos.terminal.resize");

  const sendKeystrokeRef = useRef<(chars: string) => void>(() => {});
  sendKeystrokeRef.current = (chars: string) => {
    if (readOnly) return;
    void sendKeystroke({
      coreId,
      leaseToken,
      chars,
    } satisfies KosKeystrokeArgs).catch(() => {});
  };

  const sendResizeRef = useRef<(cols: number, rows: number) => void>(() => {});
  sendResizeRef.current = (cols: number, rows: number) => {
    if (readOnly) return;
    void sendResize({
      coreId,
      leaseToken,
      cols,
      rows,
    } satisfies KosTerminalResizeArgs).catch(() => {});
  };

  // Downlink: write each terminal frame straight into xterm. Frames are already
  // xterm-ready (the mod mapped kOS's screen diff through TerminalXtermMapper).
  // A full-repaint frame carries its own screen clear, so a plain write resyncs
  // a late/reconnecting viewer.
  //
  // Line-mode composition guard (Gap C, terminal-integrity adversarial
  // review): a delayed, authoritative echo for an ALREADY-committed line
  // (typed + Enter) can still arrive after the operator has started
  // composing the NEXT line locally. Writing it blind would land in the
  // middle of that in-progress, not-yet-committed text and merge the two.
  // Retract the local composition first (same "\r\x1b[K" the Enter
  // handler already uses), write the server's chunk, then re-echo the
  // composition on top so the operator's in-flight typing isn't lost —
  // preserves line-mode's instant feedback while keeping the server's
  // echo as the only copy that ever lands on a clean line.
  useStreamEvent<KosTerminalFrame>(`kos.terminal.${coreId}`, (frame) => {
    const term = termRef.current;
    if (!term) return;
    const composing = lineBufferRef.current;
    if (composing.length > 0) {
      term.write("\r\x1b[K");
    }
    term.write(frame.chunk);
    if (composing.length > 0) {
      term.write(composing);
    }
  });

  // Lease lifecycle: acquire on attach, release on detach.
  useEffect(() => {
    if (readOnly) return;
    void sendOpen({ coreId, leaseToken } satisfies KosTerminalOpenArgs).catch(
      () => {},
    );
    return () => {
      void sendClose({
        coreId,
        leaseToken,
      } satisfies KosTerminalCloseArgs).catch(() => {});
    };
  }, [coreId, readOnly, leaseToken, sendOpen, sendClose]);

  // xterm setup — deferred until the container has real layout so the first
  // render lands at a sensible size.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let teardown: (() => void) | null = null;
    let sizeWaiter: ResizeObserver | null = null;
    let fallbackTimer: ReturnType<typeof setTimeout> | null = null;
    let cancelled = false;

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
      fitAddon.fit();
      termRef.current = term;

      if (readOnly) {
        term.writeln("\x1b[2m[read-only]\x1b[0m");
      }

      if (!readOnly) {
        if (lineMode) {
          lineBufferRef.current = "";
          term.onData((data) => {
            lineBufferRef.current = handleLineModeInput(
              data,
              lineBufferRef.current,
              term,
              (chars) => sendKeystrokeRef.current(chars),
            );
          });
        } else {
          term.onData((data) => sendKeystrokeRef.current(data));
        }
      }

      // Track container size → xterm fit, and mirror the fitted dimensions to
      // the shared CPU screen (kOS's NAWS analogue) while we hold the lease.
      const observer = new ResizeObserver(() => {
        const next = fitAddon.proposeDimensions();
        if (next && next.rows >= MIN_REASONABLE_ROWS) {
          fitAddon.fit();
        }
      });
      observer.observe(container);

      term.onResize(({ cols, rows }) => {
        sendResizeRef.current(cols, rows);
      });

      teardown = () => {
        observer.disconnect();
        term.dispose();
        termRef.current = null;
      };
    }

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
      fallbackTimer = setTimeout(runSetup, 500);
    }

    return () => {
      cancelled = true;
      sizeWaiter?.disconnect();
      if (fallbackTimer !== null) clearTimeout(fallbackTimer);
      teardown?.();
    };
    // The live screen mounts only once a coreId exists (keyed child), so this
    // runs on mount; the downlink/uplink use refs, no mid-life teardown.
  }, [readOnly, lineMode]);

  return <Container ref={containerRef} $readOnly={readOnly} />;
}

function KosTerminalConfigComponent({
  config,
  onSave,
}: Readonly<ConfigComponentProps<KosTerminalConfig>>) {
  const [readOnly, setReadOnly] = useState(config?.readOnly ?? false);
  const [lineMode, setLineMode] = useState(config?.lineMode ?? false);
  const [cpuName, setCpuName] = useState(config?.cpuName ?? "");

  const candidate = useMemo<KosTerminalConfig>(
    () => ({
      readOnly,
      lineMode,
      cpuName: cpuName.trim() ? cpuName.trim() : undefined,
    }),
    [readOnly, lineMode, cpuName],
  );

  useModalSaveBar({
    onSave: () => onSave(candidate),
    value: candidate,
    saved: config ?? {},
  });

  return (
    <ConfigForm>
      <Field>
        <FieldLabel htmlFor="kos-terminal-cpu">Attach to CPU</FieldLabel>
        <Input
          id="kos-terminal-cpu"
          type="text"
          value={cpuName}
          onChange={(e) => setCpuName(e.target.value)}
          placeholder="e.g. lander"
        />
        <FieldHint>
          Tagname of the kOS CPU to attach to. Leave blank to auto-attach when
          there is one CPU, or pick from the list when there are several.
        </FieldHint>
      </Field>

      <Field>
        <Switch checked={readOnly} onChange={setReadOnly} label="Read-only" />
        <FieldHint>
          When on, keystrokes are not forwarded — the terminal is a passive
          viewer.
        </FieldHint>
      </Field>

      <Field>
        <Switch checked={lineMode} onChange={setLineMode} label="Line mode" />
        <FieldHint>
          Compose each line locally with instant echo and send it in one go on
          Enter, rather than a keystroke at a time. Cuts round-trips under
          light-time delay.
        </FieldHint>
      </Field>
    </ConfigForm>
  );
}

registerComponent<KosTerminalConfig>({
  id: "kos-terminal",
  name: "kOS Terminal",
  description:
    "Interactive or read-only terminal for a kOS CPU, streamed in-process over the Uplink (no proxy).",
  tags: ["kos", "control", "telemetry"],
  defaultSize: { w: 18, h: 15 },
  minSize: { w: 8, h: 6 },
  openConfigOnAdd: true,
  component: KosTerminalComponent,
  configComponent: KosTerminalConfigComponent,
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

const CpuPicker = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
  padding: 12px;
`;

const CpuPicker__Label = styled.span`
  font-size: 12px;
  color: var(--color-text-muted);
`;
