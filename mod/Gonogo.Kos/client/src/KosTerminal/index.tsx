import type { ComponentProps, ConfigComponentProps } from "@ksp-gonogo/core";
import { registerComponent, safeRandomUuid } from "@ksp-gonogo/core";
import { useReplaySessionActive } from "@ksp-gonogo/data";
import {
  useCommand,
  useLatestValue,
  useStream,
  useStreamEvent,
  useUtNow,
} from "@ksp-gonogo/sitrep-client";
import type {
  CommsLink,
  KosKeystrokeArgs,
  KosProcessorInfo,
  KosTerminalCloseArgs,
  KosTerminalFrame,
  KosTerminalOpenArgs,
  KosTerminalResizeArgs,
  PendingUplinkQueue,
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
import { formatCountdown } from "@ksp-gonogo/ui-kit";
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

// The kOS terminal is a FIXED-size grid — mirroring the telnet solution that
// worked well. The widget never fits-to-pixels (which line-wraps kOS's output
// in a narrow panel) and imposes this one size on the shared CPU screen once.
// 80 cols is wider than any kOS screen line, so kOS output never wraps.
const KOS_TERM_COLS = 80;
const KOS_TERM_ROWS = 24;

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

// ── Line-mode composition ────────────────────────────────────────────────────

/**
 * Reduces one input character into the in-progress line-mode composition —
 * a PURE buffer transform that never touches the terminal. The composition is
 * rendered in a dedicated input bar (see `CompositionBar` in the component),
 * NOT echoed into the shared xterm screen: the terminal shows only the
 * server-authoritative screen, so an absolutely-positioned server frame can
 * never merge into, or wipe, the operator's in-progress typing.
 *
 * On Enter the whole line (+ `\r`) is flushed through `sendChars` as one
 * message (one uplink round-trip per line under light-time delay, not per
 * char); kOS's own echo of that line lands in the terminal a round trip later
 * as the sole persisted copy. Backspace edits the buffer; other C0 control
 * chars are ignored. Pasted / multi-char input is processed char-by-char.
 */
function reduceLineModeChar(
  ch: string,
  buffer: string,
  sendChars: (chars: string) => void,
): string {
  if (ch === "\r" || ch === "\n") {
    sendChars(`${buffer}\r`);
    return "";
  }
  if (ch === "\x7f" || ch === "\b") {
    return buffer.length === 0 ? buffer : buffer.slice(0, -1);
  }
  // biome-ignore lint/suspicious/noControlCharactersInRegex: matching C0 control range is the intent
  if (/[\x00-\x1f]/.test(ch)) return buffer;
  return `${buffer}${ch}`;
}

function reduceLineModeInput(
  data: string,
  buffer: string,
  sendChars: (chars: string) => void,
): string {
  let next = buffer;
  for (const ch of data) {
    next = reduceLineModeChar(ch, next, sendChars);
  }
  return next;
}

// ── Line-mode history recall ─────────────────────────────────────────────────

// Shell-style recall over lines THIS terminal session has sent via line-mode
// Enter — kept in a plain ref (not persisted, not shared across terminals).
// Capped well beyond any realistic single-session line count.
const LINE_HISTORY_CAP = 100;

/**
 * Appends a just-sent line to the session's recall history, dropping the
 * oldest entry once past `LINE_HISTORY_CAP`.
 */
function pushLineHistory(history: readonly string[], line: string): string[] {
  const next = [...history, line];
  return next.length > LINE_HISTORY_CAP
    ? next.slice(next.length - LINE_HISTORY_CAP)
    : next;
}

interface HistoryNav {
  /** Steps back from the most recent entry (0 = most recent). */
  index: number;
  value: string;
}

/**
 * Up-arrow: walks one entry further into the past. No-ops on empty history;
 * pins at the oldest entry rather than wrapping.
 */
function recallOlder(
  history: readonly string[],
  index: number | null,
): HistoryNav | null {
  if (history.length === 0) return null;
  const nextIndex =
    index === null ? 0 : Math.min(index + 1, history.length - 1);
  return { index: nextIndex, value: history[history.length - 1 - nextIndex] };
}

/**
 * Down-arrow: walks one entry back toward the present. Past the newest entry
 * this restores the pre-recall draft (signalled by a `null` index) rather
 * than continuing to recall. No-op when not currently browsing history.
 */
function recallNewer(
  history: readonly string[],
  index: number | null,
  draft: string,
): { index: number | null; value: string } | null {
  if (index === null) return null;
  if (index === 0) return { index: null, value: draft };
  const nextIndex = index - 1;
  return { index: nextIndex, value: history[history.length - 1 - nextIndex] };
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
  const lineMode = config?.lineMode ?? true;

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
              ? `Waiting for kOS CPU "${cpuName}"...`
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
  // The in-progress, not-yet-committed line-mode composition (typed since the
  // last Enter). It lives in a dedicated input bar, NEVER echoed into the
  // xterm screen — so a server frame can't merge into or wipe it. The ref is
  // the synchronous source of truth the onData handler mutates; `composition`
  // state mirrors it for the bar's render.
  const lineBufferRef = useRef<string>("");
  const [composition, setComposition] = useState("");
  // Shell-style history recall over lines sent via line-mode Enter this
  // session (see `recallOlder`/`recallNewer`). `historyIndexRef` is `null`
  // while editing the live draft; `historyDraftRef` snapshots that draft the
  // moment up-arrow starts browsing, so down-arrow can restore it past the
  // newest entry.
  const lineHistoryRef = useRef<string[]>([]);
  const historyIndexRef = useRef<number | null>(null);
  const historyDraftRef = useRef<string>("");
  // lineMode can flip at runtime (a config edit) and must NOT tear down the
  // live xterm — the onData handler reads this ref per keystroke instead of
  // capturing lineMode in its setup effect, so the running terminal (and its
  // on-screen content) survives the switch. Clear any in-progress composition
  // (and history-browse position) on a mode change so a stale line doesn't
  // linger in the bar.
  const lineModeRef = useRef(lineMode);
  lineModeRef.current = lineMode;
  // Intentionally keyed on lineMode: this effect exists to clear the
  // composition WHEN the mode flips, not to react to values it reads.
  // biome-ignore lint/correctness/useExhaustiveDependencies: lineMode is the trigger, not a read dependency
  useEffect(() => {
    lineBufferRef.current = "";
    setComposition("");
    historyIndexRef.current = null;
    historyDraftRef.current = "";
  }, [lineMode]);
  // Keep xterm's own cursor blink in sync with which surface owns input —
  // see the matching comment on the `cursorBlink` constructor option above.
  // Separate from the composition-clearing effect above (different deps:
  // this one legitimately reacts to `readOnly` too) and gated on
  // `termRef.current` existing, since a runtime lineMode/readOnly flip can
  // land before or after the terminal's own mount-time setup effect.
  useEffect(() => {
    if (termRef.current) {
      termRef.current.options.cursorBlink = !readOnly && !lineMode;
    }
  }, [lineMode, readOnly]);

  // `comms.delay`/`system.uplink.pending`/`comms.link` are all read through
  // `useLatestValue`, NOT the certainty-gated `useStream`/`useViewUt` path.
  // comms.delay and the pending-uplink queue's `dispatchedAt` are TrueNow
  // command-centre bookkeeping stamped in real UT; comms.link is Delayed but
  // freeze-EXEMPT, so useLatestValue reads its most-recent arrived frame (the
  // link edge at the light-time horizon) directly. Reading any of them through
  // `useStream`/`useViewUt` — the
  // certainty-gated, delay-consistent path meant for the vessel's own
  // (genuinely delayed) telemetry — makes the strip appear, and clear, one
  // whole one-way-delay late: the queue entry isn't visible until the
  // delayed view frame reaches its `validAt`, and the countdown is
  // computed against a `utNow` that's already lagging by the same amount.
  // `useLatestValue`/`useUtNow` read the client's raw sticky value / the
  // clock's undelayed `utNowEstimate()` directly, so the strip tracks real
  // dispatch time instead of the delayed view.
  // `oneWaySeconds` is nullable — null when there is no measurable
  // ControlPath, as opposed to 0 for the delay-feature-disabled-but-
  // connected case (comms-delay-nullable-when-no-path fix). Both read as
  // "nothing to show" below, same as the pre-fix 0 sentinel did.
  const commsDelay = useLatestValue<{ oneWaySeconds: number | null }>(
    "comms.delay",
  );

  // PURE prediction fuel for the strip below. Nothing here is ever read for
  // anything execution/result-shaped: the payload has no such field, and a
  // row disappears only because the engine pruned it from a later snapshot,
  // never because this widget decided a command "completed".
  const queue = useLatestValue<PendingUplinkQueue>("system.uplink.pending");
  const utNow = useUtNow();

  // Whether the ground station has a path to the craft — read off the
  // client-facing `comms.link` connectivity MetaTopic (the de-publicised
  // TrueNow `comms.connectivity` successor; comms-delay-model-consistency
  // spec). comms.link is Delayed + freeze-EXEMPT, so its disconnect edge
  // reveals at the light-time horizon — delay-consistent with this terminal's
  // own (delayed) screen rather than a real-time TrueNow read. `undefined` (no
  // link data yet) is treated as connected: only a CONFIRMED `connected ===
  // false` blocks a send / shows the warning below.
  const connectivity = useLatestValue<CommsLink>("comms.link");
  const noPath = connectivity?.connected === false;

  // Uplink commands. Each `send` is a stable useCallback (keyed by command) —
  // destructured so effects can depend on it without the surrounding
  // per-render `{send,status}` object re-triggering them. The imperative xterm
  // handlers call the latest sender via refs.
  const { send: sendKeystroke } = useCommand("kos.keystroke");
  const { send: sendOpen } = useCommand("kos.terminal.open");
  const { send: sendClose } = useCommand("kos.terminal.close");
  const { send: sendResize } = useCommand("kos.terminal.resize");

  // Scopes this terminal's uplinks to its own CPU — used both to tag
  // outgoing line-mode sends and to filter the in-transit strip below, so
  // the two never drift apart.
  const terminalTopic = `kos/${coreId}`;

  // `label` is only ever non-empty for a line-mode Enter (the composed line
  // IS the label, see `reduceLineModeInput`'s callsite below); char-mode
  // keystrokes stay label-less. Purely cosmetic on the wire — it plays no
  // role in dispatch/correlation and never feeds the prediction-only strip
  // beyond what the server already echoed back onto the pending-queue entry.
  //
  // Blocks the dispatch outright when `noPath` (a confirmed
  // `comms.connectivity.connected === false`) — the server used to silently
  // drop a command sent with no line of sight; blocking client-side instead
  // means the operator sees why nothing happened (the "No path" warning
  // below) rather than a command vanishing into a queue that will never
  // move. Char-mode keystrokes are blocked the same way as a line-mode
  // Enter — the CPU is equally unreachable either way.
  const sendKeystrokeRef = useRef<(chars: string, label?: string) => void>(
    () => {},
  );
  sendKeystrokeRef.current = (chars: string, label?: string) => {
    if (readOnly || noPath) return;
    void sendKeystroke(
      { coreId, leaseToken, chars } satisfies KosKeystrokeArgs,
      label ? { label, topic: terminalTopic } : undefined,
    ).catch(() => {});
  };

  // Downlink: write each terminal frame straight into xterm. Frames are already
  // xterm-ready (the mod mapped kOS's screen diff through TerminalXtermMapper),
  // and a full-repaint frame carries its own screen clear, so a plain write
  // resyncs a late/reconnecting viewer AND lets a periodic keyframe self-heal a
  // dropped diff. No composition juggling: line-mode input lives in its own bar
  // (never in this buffer), so an absolutely-positioned server frame can't
  // collide with the operator's in-progress typing.
  useStreamEvent<KosTerminalFrame>(`kos.terminal.${coreId}`, (frame) => {
    termRef.current?.write(frame.chunk);
  });

  // Lease lifecycle: acquire on attach, release on detach.
  useEffect(() => {
    if (readOnly) return;
    void sendOpen({ coreId, leaseToken } satisfies KosTerminalOpenArgs).catch(
      () => {},
    );
    // Impose the widget's FIXED terminal size on the CPU screen once (the
    // telnet NAWS-once pattern) — no dynamic fit-to-pixels. See KOS_TERM_*.
    void sendResize({
      coreId,
      leaseToken,
      cols: KOS_TERM_COLS,
      rows: KOS_TERM_ROWS,
    } satisfies KosTerminalResizeArgs).catch(() => {});
    return () => {
      void sendClose({
        coreId,
        leaseToken,
      } satisfies KosTerminalCloseArgs).catch(() => {});
    };
  }, [coreId, readOnly, leaseToken, sendOpen, sendClose, sendResize]);

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
        // Line mode hands the active caret to `CompositionBar` (its own
        // blinking cursor sits on the composed line); leaving xterm's native
        // cursor ALSO blinking at the last-painted `kOS>` position reads as
        // two disagreeing cursors. Suppress it whenever the bar owns input —
        // char mode has no bar, so the terminal cursor stays the sole one.
        // Read via the ref (not the `lineMode` prop) so this initial value
        // doesn't become an exhaustive-deps dependency of the mount-only
        // setup effect below; the reactive toggle sync effect keeps it
        // current after mount.
        cursorBlink: !readOnly && !lineModeRef.current,
        cols: KOS_TERM_COLS,
        rows: KOS_TERM_ROWS,
      });
      term.open(container);
      termRef.current = term;

      if (readOnly) {
        term.writeln("\x1b[2m[read-only]\x1b[0m");
      }

      if (!readOnly) {
        // One handler for the terminal's whole lifetime; it reads lineModeRef
        // per keystroke so a runtime line-mode toggle never recreates xterm.
        // Line mode accumulates into the composition bar (no echo into this
        // screen); char mode forwards each keystroke straight to the CPU.
        term.onData((data) => {
          if (!lineModeRef.current) {
            sendKeystrokeRef.current(data);
            return;
          }
          // Up-arrow: recall history, one entry further into the past.
          if (data === "\x1b[A") {
            if (historyIndexRef.current === null) {
              historyDraftRef.current = lineBufferRef.current;
            }
            const nav = recallOlder(
              lineHistoryRef.current,
              historyIndexRef.current,
            );
            if (nav) {
              historyIndexRef.current = nav.index;
              lineBufferRef.current = nav.value;
              setComposition(nav.value);
            }
            return;
          }
          // Down-arrow: walk history back toward the present / live draft.
          if (data === "\x1b[B") {
            const nav = recallNewer(
              lineHistoryRef.current,
              historyIndexRef.current,
              historyDraftRef.current,
            );
            if (nav) {
              historyIndexRef.current = nav.index;
              lineBufferRef.current = nav.value;
              setComposition(nav.value);
            }
            return;
          }
          // Ctrl+C: clear the in-progress line locally AND forward the
          // interrupt itself so a running kOS program actually breaks — this
          // is a control signal, not a composed line, so it never joins line
          // history.
          if (data === "\x03") {
            historyIndexRef.current = null;
            lineBufferRef.current = "";
            setComposition("");
            sendKeystrokeRef.current("\x03", "^C");
            return;
          }
          // Any regular edit leaves history-browse mode — recalling a line
          // then typing continues editing it as the new live draft.
          historyIndexRef.current = null;
          const next = reduceLineModeInput(
            data,
            lineBufferRef.current,
            // `chars` carries the trailing `\r` `reduceLineModeChar` appends
            // for the wire (kOS needs the Enter byte); the label is the
            // operator-facing composed line, so it's trimmed of that
            // control character — the queue strip renders the label
            // verbatim and must not show a raw CR.
            (chars) => {
              const label = chars.replace(/[\r\n]+$/, "");
              lineHistoryRef.current = pushLineHistory(
                lineHistoryRef.current,
                label,
              );
              sendKeystrokeRef.current(chars, label);
            },
          );
          lineBufferRef.current = next;
          setComposition(next);
        });
      }

      teardown = () => {
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
    // runs on mount; the downlink/uplink (and lineMode) use refs, so a
    // line-mode toggle never tears down and wipes the terminal.
  }, [readOnly]);

  // Threshold split (spec §4): char-mode always gets the badge; line-mode
  // gets the badge ONLY when the delay is too short for a strip to be worth
  // it (<=1s one-way), otherwise the full in-transit strip. The two are
  // mutually exclusive — never both. A read-only viewer in line mode with a
  // long delay gets neither (it dispatches no commands, so nothing to queue).
  const showBadge =
    commsDelay !== undefined &&
    (commsDelay.oneWaySeconds ?? 0) > 0 &&
    (!lineMode || (commsDelay.oneWaySeconds ?? 0) <= 1);
  const showStrip =
    lineMode &&
    !readOnly &&
    commsDelay !== undefined &&
    (commsDelay.oneWaySeconds ?? 0) > 1 &&
    utNow !== undefined;
  // Narrowed, non-optional locals for the JSX below — `showBadge`/`showStrip`
  // are plain booleans, so TS can't carry their truthiness back onto
  // `commsDelay`/`utNow` at the read sites; only-render-when-defined instead.
  const badgeDelay = showBadge ? commsDelay : undefined;
  const stripUtNow = showStrip ? utNow : undefined;
  // Scope the strip to THIS terminal's CPU — the queue is a single
  // server-wide snapshot shared across every open terminal.
  const myPending = (queue?.pending ?? []).filter(
    (item) => item.topic === terminalTopic,
  );

  return (
    <TerminalShell>
      <TerminalFrame>
        <Container ref={containerRef} $readOnly={readOnly} />
        {badgeDelay && (
          <DelayBadge role="status" aria-label="Signal delay">
            round-trip ~{(2 * (badgeDelay.oneWaySeconds ?? 0)).toFixed(1)}s
          </DelayBadge>
        )}
      </TerminalFrame>
      {!readOnly && noPath && (
        <NoPathBadge role="status">
          No path — commands are not being sent
        </NoPathBadge>
      )}
      {stripUtNow !== undefined && myPending.length > 0 && (
        <UplinkStrip aria-label="Uplink queue">
          {myPending.map((item) => {
            const reachUt = item.dispatchedAt + item.oneWaySeconds;
            const replyUt = item.dispatchedAt + 2 * item.oneWaySeconds;
            const inTransit = stripUtNow < reachUt;
            const remaining = (inTransit ? reachUt : replyUt) - stripUtNow;
            return (
              <UplinkStrip__Row key={item.id} $inTransit={inTransit}>
                <UplinkStrip__Arrow aria-hidden="true">
                  {inTransit ? "↑" : "↓"}
                </UplinkStrip__Arrow>
                <UplinkStrip__Label>
                  {item.label || item.command}
                </UplinkStrip__Label>
                <UplinkStrip__Phase>
                  {formatCountdown(remaining)}
                </UplinkStrip__Phase>
              </UplinkStrip__Row>
            );
          })}
        </UplinkStrip>
      )}
      {lineMode && !readOnly && (
        <CompositionBar aria-label="Line-mode input">
          <CompositionBar__Prompt aria-hidden="true">❯</CompositionBar__Prompt>
          <CompositionBar__Text>{composition}</CompositionBar__Text>
          <CompositionBar__Cursor aria-hidden="true" />
        </CompositionBar>
      )}
    </TerminalShell>
  );
}

function KosTerminalConfigComponent({
  config,
  onSave,
}: Readonly<ConfigComponentProps<KosTerminalConfig>>) {
  const [readOnly, setReadOnly] = useState(config?.readOnly ?? false);
  const [lineMode, setLineMode] = useState(config?.lineMode ?? true);
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
  defaultConfig: { lineMode: true },
});

export { KosTerminalComponent };

const TerminalShell = styled.div`
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  min-height: 0;
  gap: 6px;
`;

// Wraps the terminal pane so the delay badge can be pinned INSIDE its
// bordered box (an absolutely-positioned corner overlay) instead of floating
// below it as a separate flex sibling — a badge floating past the pane's own
// border reads as rendering outside the widget's visual bounds. Carries the
// flex-sizing props `Container` used to own directly; `Container` itself is
// now a plain 100%-of-frame box so xterm's own mount target is unaffected.
const TerminalFrame = styled.div`
  position: relative;
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
`;

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

// Line-mode input bar: the operator's in-progress composition, kept OFF the
// server-authoritative terminal screen so absolutely-positioned frames can
// never collide with it. Cleared on Enter (the line is sent; kOS's own echo
// lands in the terminal above a round-trip later).
const CompositionBar = styled.div`
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  padding: 6px 8px;
  min-height: 1.6em;
  background: var(--color-surface-panel);
  border: 1px solid var(--color-accent-fg);
  border-radius: 4px;
  font-family: monospace;
  font-size: 13px;
  box-sizing: border-box;
`;

// No gap here — the cursor block must sit flush against the trailing
// character of `CompositionBar__Text`, not offset by a flex gap (that read
// as the cursor sitting one character off the actual trailing character).
// The prompt keeps its own breathing room via `margin-right` instead of a
// container-wide `gap` that would otherwise apply between every child.
const CompositionBar__Prompt = styled.span`
  color: var(--color-accent-fg);
  font-weight: bold;
  margin-right: 8px;
`;

const CompositionBar__Text = styled.span`
  color: var(--color-text-primary);
  white-space: pre-wrap;
  word-break: break-all;
`;

const CompositionBar__Cursor = styled.span`
  display: inline-block;
  width: 0.6em;
  height: 1.1em;
  background: var(--color-accent-fg);
  vertical-align: text-bottom;

  @media (prefers-reduced-motion: no-preference) {
    animation: kos-caret-blink 1s step-end infinite;
  }

  @keyframes kos-caret-blink {
    50% {
      opacity: 0;
    }
  }
`;

// Steady-state warning while `comms.link.connected === false` — a
// confirmed line-of-sight loss, not merely "no link data yet" (see
// `noPath`'s own doc comment). Error/danger tone (the same
// `--color-status-nogo-*` pair `CommSignal` uses for its "lost" state) so it
// reads unambiguously as a blocking condition, not an informational badge
// like `DelayBadge` below it.
const NoPathBadge = styled.div`
  flex: 0 0 auto;
  align-self: flex-start;
  padding: 2px 8px;
  font-family: monospace;
  font-size: 11px;
  font-weight: bold;
  color: var(--color-status-nogo-fg);
  background: var(--color-status-nogo-bg);
  border: 1px solid var(--color-status-nogo-fg);
  border-radius: 4px;
`;

// Compact delay readout: char-mode always, line-mode only when the delay is
// too short (<=1s one-way) for a strip to be worth it — see `showBadge`.
// Pinned as an absolutely-positioned corner overlay INSIDE `TerminalFrame`
// (a sibling of `Container`, not a descendant — `Container`'s own
// `overflow: hidden` is reserved for xterm's content) rather than a flex
// item below the terminal pane, so it always renders within the terminal's
// own bordered box instead of floating past it.
const DelayBadge = styled.div`
  position: absolute;
  top: 8px;
  right: 8px;
  z-index: 1;
  padding: 2px 8px;
  font-family: monospace;
  font-size: 11px;
  color: var(--color-text-muted);
  background: var(--color-surface-panel);
  border: 1px solid var(--color-border-subtle);
  border-radius: 4px;
`;

// Line-mode, oneWaySeconds > 1: one row per in-flight command from
// `system.uplink.pending`, predicting its transit/reply phase from
// `dispatchedAt + oneWaySeconds` against the live view UT — never anything
// execution/result-shaped (the payload carries none). Rows disappear only
// because the engine pruned them from a later snapshot.
const UplinkStrip = styled.div`
  flex: 0 0 auto;
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 4px 8px;
  font-family: monospace;
  font-size: 11px;
  background: var(--color-surface-panel);
  border: 1px solid var(--color-border-subtle);
  border-radius: 4px;
  box-sizing: border-box;
`;

const UplinkStrip__Row = styled.div<{ $inTransit: boolean }>`
  display: flex;
  align-items: baseline;
  gap: 6px;
  color: ${({ $inTransit }) =>
    $inTransit ? "var(--color-text-primary)" : "var(--color-text-muted)"};
`;

const UplinkStrip__Arrow = styled.span`
  flex: 0 0 auto;
  color: var(--color-accent-fg);

  @media (prefers-reduced-motion: no-preference) {
    animation: kos-uplink-pulse 1.6s ease-in-out infinite;
  }

  @keyframes kos-uplink-pulse {
    50% {
      opacity: 0.35;
    }
  }
`;

const UplinkStrip__Label = styled.span`
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const UplinkStrip__Phase = styled.span`
  flex: 0 0 auto;
  color: inherit;
  opacity: 0.85;
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
