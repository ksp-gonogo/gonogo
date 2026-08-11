import type {
  CommsLink,
  ComponentProps,
  ConfigComponentProps,
} from "@ksp-gonogo/sitrep-sdk";
import {
  registerComponent,
  safeRandomUuid,
  useCommand,
  useLatestValue,
  useReplaySessionActive,
  useRouteCommands,
  useStream,
  useStreamEvent,
  value,
} from "@ksp-gonogo/sitrep-sdk";
import {
  ComboboxListbox,
  type ComboboxOption,
  ComputerIcon,
  ConfigForm,
  EmptyState,
  Field,
  FieldHint,
  FieldLabel,
  filterComboboxOptions,
  flattenComboboxGroups,
  GhostButton,
  groupComboboxOptions,
  InFlightList,
  type InFlightListItem,
  Input,
  moveComboboxActiveIndex,
  Panel,
  PanelTitle,
  Switch,
  Unit,
  useModalSaveBar,
} from "@ksp-gonogo/ui-kit";
import { Terminal } from "@xterm/xterm";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import styled from "styled-components";
import type {
  KosKeystrokeArgs,
  KosProcessorInfo,
  KosTerminalCloseArgs,
  KosTerminalFrame,
  KosTerminalOpenArgs,
  KosTerminalResizeArgs,
} from "../__generated__/contract";
import { KOS } from "../uplink";
import { useKosScriptListing } from "./useKosScriptListing";
import "@xterm/xterm/css/xterm.css";

/**
 * The terminal's character size, in px, shared by xterm's own `fontSize`
 * option and by `CompositionBar` below it.
 *
 * Off the type scale on purpose and in one place on purpose. The composition
 * bar renders the operator's in-progress input line directly beneath the
 * xterm screen in the same monospace family, so the composed characters only
 * line up on the terminal's character pitch while the two sizes are equal,
 * and xterm's is a JS number no CSS pass can reach. --font-size-sm is 12px on
 * a desktop (a -1px snap that breaks the match) and 13px only on coarse
 * pointers, so taking the token would make the pitch correct on a Steam Deck
 * and wrong everywhere else. `CompositionBar`'s min-height and the caret
 * block's width/height are expressed in `em` against this value, so they
 * follow it automatically.
 */
const TERMINAL_FONT_PX = 13;

interface KosTerminalConfig {
  /** When true, keystrokes are not forwarded, a passive downlink viewer only. */
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
  /**
   * Script paths offered by the `/`-script picker (kos-terminal-script-picker,
   * hub-wizard-kos Phase 1, increment (a)). A placeholder data source for
   * now: increment (b) replaces this with a live drive listing dispatched
   * over the kos Uplink's `executeScript` RPC, so this field is not exposed
   * in the config UI below and is expected to go away once that lands.
   */
  scriptPaths?: string[];
}

// The kOS terminal is a FIXED-size grid, mirroring the telnet solution that
// worked well. The widget never fits-to-pixels (which line-wraps kOS's output
// in a narrow panel) and imposes this one size on the shared CPU screen once.
// 80 cols is wider than any kOS screen line, so kOS output never wraps.
const KOS_TERM_COLS = 80;
const KOS_TERM_ROWS = 24;

// ── CPU resolution ───────────────────────────────────────────────────────────

/**
 * Resolve the target CPU's `coreId` from the live processor list. An explicit
 * in-widget pick wins; then the configured tagname; then, only when a single
 * CPU exists, that sole CPU. Returns null when the choice is still ambiguous
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

/**
 * The picker label for each processor, in list order. A CPU shows its name-tag
 * if it has one, else its part name (e.g. "Probe Core"), else a bare
 * "CPU <coreId>". When two CPUs would otherwise read identically (typically
 * untagged copies of the same part), each gets a " (n)" suffix so they stay
 * tellable apart, per the operator's "Probe Core (2)".
 */
export function cpuPickerLabels(
  processors: readonly KosProcessorInfo[],
): string[] {
  const base = processors.map((p) => p.tag ?? p.partName ?? `CPU ${p.coreId}`);
  const totals = new Map<string, number>();
  for (const label of base) totals.set(label, (totals.get(label) ?? 0) + 1);
  const seen = new Map<string, number>();
  return base.map((label) => {
    if ((totals.get(label) ?? 0) <= 1) return label;
    const n = (seen.get(label) ?? 0) + 1;
    seen.set(label, n);
    return `${label} (${n})`;
  });
}

// ── Line-mode composition ────────────────────────────────────────────────────

/**
 * The in-progress line-mode composition: the composed text plus a cursor
 * position within it (0 = before the first character, `text.length` = after
 * the last). Replaces a bare `string` buffer so Left/Right/Home/End can move
 * the insertion point instead of typing always appending to the tail.
 */
interface LineComposition {
  text: string;
  cursor: number;
}

const EMPTY_COMPOSITION: LineComposition = { text: "", cursor: 0 };

/**
 * Reduces one input character into the in-progress line-mode composition,
 * a PURE transform that never touches the terminal. The composition is
 * rendered in a dedicated input bar (see `CompositionBar` in the component),
 * NOT echoed into the shared xterm screen: the terminal shows only the
 * server-authoritative screen, so an absolutely-positioned server frame can
 * never merge into, or wipe, the operator's in-progress typing.
 *
 * On Enter the whole line (+ `\r`) is flushed through `sendChars` as one
 * message (one uplink round-trip per line under light-time delay, not per
 * char); kOS's own echo of that line lands in the terminal a round trip later
 * as the sole persisted copy. Typed characters INSERT at the cursor (not
 * always the tail) and the cursor advances past them; backspace deletes the
 * character BEFORE the cursor. Other C0 control chars are ignored. Pasted /
 * multi-char input is processed char-by-char. Cursor movement itself
 * (Left/Right/Home/End/Delete) is handled by the component's `onData`
 * handler directly via `moveCursor`/`cursorToStart`/`cursorToEnd`/
 * `deleteForward` below: those arrive as whole escape sequences the handler
 * matches before ever calling this reducer, same as Up/Down history recall.
 *
 * `canSend` gates Enter specifically (kos-nopath-block-input fix): with no
 * comms path, `sendChars` would no-op at the dispatch layer anyway (the
 * `sendKeystrokeRef` guard), but by then the line had already been cleared
 * and pushed to history: the command visibly "vanished" even though it was
 * never sent. Refusing Enter HERE, at input-acceptance, before either of
 * those side effects, is what actually keeps the typed command in the box.
 * Regular typing/backspace still edits the composition while blocked, so the
 * operator can keep composing for when the path returns.
 */
function reduceLineModeChar(
  ch: string,
  comp: LineComposition,
  sendChars: (chars: string) => void,
  canSend: boolean,
): LineComposition {
  if (ch === "\r" || ch === "\n") {
    if (!canSend) return comp;
    sendChars(`${comp.text}\r`);
    return EMPTY_COMPOSITION;
  }
  if (ch === "\x7f" || ch === "\b") {
    if (comp.cursor === 0) return comp;
    return {
      text: comp.text.slice(0, comp.cursor - 1) + comp.text.slice(comp.cursor),
      cursor: comp.cursor - 1,
    };
  }
  // biome-ignore lint/suspicious/noControlCharactersInRegex: matching C0 control range is the intent
  if (/[\x00-\x1f]/.test(ch)) return comp;
  return {
    text: comp.text.slice(0, comp.cursor) + ch + comp.text.slice(comp.cursor),
    cursor: comp.cursor + 1,
  };
}

function reduceLineModeInput(
  data: string,
  comp: LineComposition,
  sendChars: (chars: string) => void,
  canSend: boolean,
): LineComposition {
  let next = comp;
  for (const ch of data) {
    next = reduceLineModeChar(ch, next, sendChars, canSend);
  }
  return next;
}

/**
 * Left/Right arrow: moves the cursor by `delta`, clamped to stay within the
 * composed text (never negative, never past `text.length`). A no-op returns
 * the SAME object (not a fresh clone) so callers can skip a state update.
 */
function moveCursor(comp: LineComposition, delta: number): LineComposition {
  const cursor = Math.max(0, Math.min(comp.text.length, comp.cursor + delta));
  return cursor === comp.cursor ? comp : { ...comp, cursor };
}

/** Home: jumps the cursor to the start of the composed line. */
function cursorToStart(comp: LineComposition): LineComposition {
  return comp.cursor === 0 ? comp : { ...comp, cursor: 0 };
}

/** End: jumps the cursor to the end of the composed line. */
function cursorToEnd(comp: LineComposition): LineComposition {
  return comp.cursor === comp.text.length
    ? comp
    : { ...comp, cursor: comp.text.length };
}

/**
 * Delete (forward-delete): removes the character AT the cursor (the one
 * immediately after it), leaving the cursor position unchanged. A no-op at
 * the end of the line, where there is nothing to delete forward.
 */
function deleteForward(comp: LineComposition): LineComposition {
  if (comp.cursor >= comp.text.length) return comp;
  return {
    text: comp.text.slice(0, comp.cursor) + comp.text.slice(comp.cursor + 1),
    cursor: comp.cursor,
  };
}

// ── Line-mode history recall ─────────────────────────────────────────────────

// Shell-style recall over lines THIS terminal session has sent via line-mode
// Enter: kept in a plain ref (not persisted, not shared across terminals).
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

// ── Script composer (`/`-trigger) ────────────────────────────────────────────

/**
 * The `/`-triggered script-run composer's state machine (kos-terminal-
 * script-picker, hub-wizard-kos Phase 1). Idle (`null`, held outside this
 * union) until `/` is typed at the very start of an empty line-mode
 * composition: see the `term.onData` callsite for the trigger. "picking"
 * filters `scriptPaths` against `query` and tracks the arrow/mouse-
 * highlighted option; confirming one (Enter or click) moves to "args",
 * where further typed characters compose optional whitespace-separated
 * trailing arguments appended to the eventual RUNPATH call. `copyLocal`
 * (increment (b), Ctrl+L to toggle, or the composer's own affordance)
 * routes the eventual send through a COPYPATH-then-RUNPATH pair against a
 * local (`1:`) copy instead of running the script where it lives, for
 * scripts run REPEATEDLY, so the archive round-trip is only paid once. A
 * second Enter in "args" builds and sends the whole command through the
 * SAME `sendKeystrokeRef`/line-history path an ordinary typed line uses,
 * see `buildRunCommand` and the `term.onData` callsite.
 */
export type ScriptComposerState =
  | { phase: "picking"; query: string; activeIndex: number }
  | { phase: "args"; path: string; argsText: string; copyLocal: boolean };

/**
 * Maps a script path to a combobox option, grouping by the path's leading
 * volume segment (`0:/widget_scripts/foo.ks` → group `"0:"`) so a listing
 * spanning several of the CPU's drives (goal spec: "across the CPU's
 * drives") renders as one heading per volume instead of an undifferentiated
 * flat list. A bare filename with no `/` gets no group (falls into
 * `groupComboboxOptions`'s default "Other" bucket).
 */
function scriptPathOption(path: string): ComboboxOption {
  const slash = path.indexOf("/");
  return slash > 0 ? { key: path, group: path.slice(0, slash) } : { key: path };
}

/**
 * Filters + groups `scriptPaths` against `query` and flattens back to
 * render/navigation order, in ONE place, both the pure `onData` reducer
 * below (for activeIndex bounds + Enter's selection) and the render site's
 * `ComboboxListbox` props call this, so the highlighted option always
 * matches what Enter would actually pick.
 */
function scriptOptionsFor(
  paths: readonly string[],
  query: string,
): { groups: Array<[string, ComboboxOption[]]>; flat: ComboboxOption[] } {
  const filtered = filterComboboxOptions(paths.map(scriptPathOption), query);
  const groups = groupComboboxOptions(filtered);
  return { groups, flat: flattenComboboxGroups(groups) };
}

/**
 * Basename of a kOS volume-qualified path: `"0:/widget_scripts/foo.ks"` →
 * `"foo.ks"`. Used to name the local (`1:`) copy `copyLocal` lands.
 */
function scriptBasename(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash === -1 ? path : path.slice(slash + 1);
}

/**
 * Builds the command line kOS will execute, from a confirmed script path
 * and raw whitespace-separated argument tokens. Each token is inserted
 * VERBATIM as a kerboscript literal (e.g. `5`, `true`, `"abc"`), the
 * composer does no quoting or type inference, matching the goal spec's
 * `RUNPATH("<path>"[, arg1, arg2])` shape.
 *
 * `copyLocal` (increment (b)'s "copy local & run" toggle) prefixes a
 * `COPYPATH("<path>", "<local>").` statement ahead of the RUNPATH, targeting
 * the script's basename on the CPU's local (`1:`) drive, both statements
 * on ONE line, still a single `kos.keystroke` round trip under light-time
 * delay, so a script run repeatedly only pays the archive round-trip once
 * (subsequent runs execute the already-local copy). Trailing `.` terminates
 * each kerboscript statement; trailing `\r` is the wire Enter byte,
 * identical to an ordinary typed line's `reduceLineModeChar` Enter path.
 */
function buildRunCommand(
  path: string,
  argsText: string,
  copyLocal: boolean,
): { chars: string; label: string } {
  const args = argsText.trim().split(/\s+/).filter(Boolean);
  const argsPart = args.length > 0 ? `, ${args.join(", ")}` : "";
  const runPath = copyLocal ? `1:/${scriptBasename(path)}` : path;
  const copyPrefix = copyLocal ? `COPYPATH("${path}", "${runPath}"). ` : "";
  const label = `${copyPrefix}RUNPATH("${runPath}"${argsPart}).`;
  return { chars: `${label}\r`, label };
}

type ScriptComposerAction =
  | { kind: "update"; next: ScriptComposerState }
  | { kind: "cancel" }
  | { kind: "send"; chars: string; label: string }
  | { kind: "noop" };

/**
 * Reduces one raw `onData` payload into the `/`-script composer's next
 * action: a PURE state machine mirroring `reduceLineModeChar`'s shape:
 * whole-token escape sequences (arrows/Enter/Escape/backspace) are matched
 * before any per-character fallthrough, exactly like the ordinary line-mode
 * handling this composer intercepts ahead of (see the `term.onData`
 * callsite). `scriptPaths` is read fresh on every call rather than carried
 * in `state`, so a live-updating list (increment (b)'s drive listing)
 * is picked up mid-compose without needing to reset the picker.
 */
function handleScriptComposerInput(
  data: string,
  state: ScriptComposerState,
  scriptPaths: readonly string[],
): ScriptComposerAction {
  if (data === "\x1b") return { kind: "cancel" };

  if (state.phase === "picking") {
    const { flat } = scriptOptionsFor(scriptPaths, state.query);
    if (data === "\x1b[A") {
      return {
        kind: "update",
        next: {
          ...state,
          activeIndex: moveComboboxActiveIndex(
            state.activeIndex,
            -1,
            flat.length,
          ),
        },
      };
    }
    if (data === "\x1b[B") {
      return {
        kind: "update",
        next: {
          ...state,
          activeIndex: moveComboboxActiveIndex(
            state.activeIndex,
            1,
            flat.length,
          ),
        },
      };
    }
    if (data === "\r" || data === "\n") {
      // Arrow-highlighted option first; fall back to the first filtered
      // result so "type a partial path + Enter" works without an arrow key
      // (matches DataKeyPicker's own Enter-with-no-navigation convention).
      const chosen = state.activeIndex >= 0 ? flat[state.activeIndex] : flat[0];
      if (!chosen) return { kind: "noop" };
      return {
        kind: "update",
        next: {
          phase: "args",
          path: chosen.key,
          argsText: "",
          copyLocal: false,
        },
      };
    }
    if (data === "\x7f" || data === "\b") {
      // Backspace on an empty query cancels the picker, same "typed a
      // trigger, changed my mind" affordance Escape gives, reachable
      // without leaving the home row.
      if (state.query.length === 0) return { kind: "cancel" };
      return {
        kind: "update",
        next: { ...state, query: state.query.slice(0, -1), activeIndex: -1 },
      };
    }
    if (data.startsWith("\x1b")) return { kind: "noop" };
    let nextQuery = state.query;
    for (const ch of data) {
      // biome-ignore lint/suspicious/noControlCharactersInRegex: matching C0 control range is the intent
      if (/[\x00-\x1f]/.test(ch)) continue;
      nextQuery += ch;
    }
    if (nextQuery === state.query) return { kind: "noop" };
    return {
      kind: "update",
      next: { ...state, query: nextQuery, activeIndex: -1 },
    };
  }

  // phase === "args": free-form trailing arguments, appended/backspaced at
  // the tail only: no cursor movement in this increment. Arrow keys are
  // swallowed here rather than falling through to the ordinary line-mode
  // history/cursor handling below, which would silently corrupt a composer
  // that owns the bar.
  if (data === "\r" || data === "\n") {
    const { chars, label } = buildRunCommand(
      state.path,
      state.argsText,
      state.copyLocal,
    );
    return { kind: "send", chars, label };
  }
  // Ctrl+L: toggle "copy local & run" (increment (b)); otherwise inert in
  // this phase (it's not forwarded to the CPU either way; see the C0
  // control-char filter below), so repurposing it here doesn't shadow any
  // existing behavior.
  if (data === "\x0c") {
    return { kind: "update", next: { ...state, copyLocal: !state.copyLocal } };
  }
  if (data === "\x7f" || data === "\b") {
    if (state.argsText.length === 0) return { kind: "noop" };
    return {
      kind: "update",
      next: { ...state, argsText: state.argsText.slice(0, -1) },
    };
  }
  if (data.startsWith("\x1b")) return { kind: "noop" };
  let nextArgs = state.argsText;
  for (const ch of data) {
    // biome-ignore lint/suspicious/noControlCharactersInRegex: matching C0 control range is the intent
    if (/[\x00-\x1f]/.test(ch)) continue;
    nextArgs += ch;
  }
  if (nextArgs === state.argsText) return { kind: "noop" };
  return { kind: "update", next: { ...state, argsText: nextArgs } };
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
  const scriptPaths = config?.scriptPaths ?? [];

  // Live CPU list from the mod's kos.processors channel (no telnet menu-scrape).
  const processors = useStream<KosProcessorInfo[]>("kos.processors") ?? [];
  const [pickedCoreId, setPickedCoreId] = useState<number | null>(null);
  const coreId = useMemo(
    () => resolveCoreId(processors, cpuName, pickedCoreId),
    [processors, cpuName, pickedCoreId],
  );
  // The resolved CPU's tagname: `executeScript` (the `/`-picker's live
  // drive-listing RPC, increment (b)) dispatches by TAGNAME, not coreId, so
  // this is looked up here (where `processors` already lives) rather than
  // re-subscribing to kos.processors a second time inside the screen.
  const cpuTag = processors.find((p) => p.coreId === coreId)?.tag;

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
          <CpuPicker role="group" aria-label="Pick a kOS CPU">
            {(() => {
              const labels = cpuPickerLabels(processors);
              return processors.map((p, i) => (
                <CpuPicker__Button
                  key={p.coreId}
                  type="button"
                  onClick={() => setPickedCoreId(p.coreId)}
                >
                  <ComputerIcon />
                  {labels[i]}
                </CpuPicker__Button>
              ));
            })()}
          </CpuPicker>
        )}
      </Panel>
    );
  }

  // A "Change CPU" affordance only makes sense when clearing the pick would
  // actually return to the picker: no `cpuName` pins the choice, and there is
  // more than one CPU to choose between. A single auto-attached CPU or a
  // config-pinned tagname would just re-resolve to the same core, so the
  // control would be a dead no-op there.
  const canChangeCpu = !cpuName && processors.length > 1;

  return (
    <KosTerminalScreen
      key={coreId}
      coreId={coreId}
      cpuTag={cpuTag}
      readOnly={readOnly}
      lineMode={lineMode}
      scriptPaths={scriptPaths}
      onChangeCpu={canChangeCpu ? () => setPickedCoreId(null) : undefined}
    />
  );
}

interface KosTerminalScreenProps {
  coreId: number;
  /** The resolved CPU's tagname, if it has one; see the `/`-picker's live listing hook. */
  cpuTag: string | undefined;
  readOnly: boolean;
  lineMode: boolean;
  scriptPaths: string[];
  /**
   * When provided, render a "Change CPU" control that invokes this to return
   * to the picker. Omitted (undefined) when there is no real choice to return
   * to (single/auto CPU, or a `cpuName`-pinned one); see `canChangeCpu`.
   */
  onChangeCpu?: () => void;
}

function KosTerminalScreen({
  coreId,
  cpuTag,
  readOnly,
  lineMode,
  scriptPaths,
  onChangeCpu,
}: Readonly<KosTerminalScreenProps>) {
  // One opaque write-lease token per attach: the mod uses it to arbitrate the
  // single-owner shared screen. Keyed by coreId (via the parent), so a CPU
  // switch mints a fresh token with a clean open/close.
  const leaseTokenRef = useRef<string>("");
  if (leaseTokenRef.current === "") leaseTokenRef.current = safeRandomUuid();
  const leaseToken = leaseTokenRef.current;

  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  // Scopes this terminal's uplinks to its own CPU, used both to tag
  // outgoing line-mode sends and to scope the in-transit strip below, so
  // the two never drift apart.
  const terminalTopic = `kos/${coreId}`;
  // The in-progress, not-yet-committed line-mode composition (typed since the
  // last Enter), text plus cursor position. It lives in a dedicated input
  // bar, NEVER echoed into the xterm screen, so a server frame can't merge
  // into or wipe it. The ref is the synchronous source of truth the onData
  // handler mutates; `composition` state mirrors it for the bar's render.
  const lineBufferRef = useRef<LineComposition>(EMPTY_COMPOSITION);
  const [composition, setComposition] =
    useState<LineComposition>(EMPTY_COMPOSITION);
  // Shell-style history recall over lines sent via line-mode Enter this
  // session (see `recallOlder`/`recallNewer`). `historyIndexRef` is `null`
  // while editing the live draft; `historyDraftRef` snapshots that draft the
  // moment up-arrow starts browsing, so down-arrow can restore it past the
  // newest entry.
  const lineHistoryRef = useRef<string[]>([]);
  const historyIndexRef = useRef<number | null>(null);
  const historyDraftRef = useRef<string>("");
  // The `/`-script composer's state (see `ScriptComposerState`): `null` when
  // idle, otherwise it OWNS input ahead of the ordinary history/cursor/typing
  // handling below (kos-terminal-script-picker). Same ref-is-truth /
  // state-mirrors-for-render split as `lineBufferRef`/`composition` above,
  // for the same reason: the onData handler is set up once and reads refs.
  const scriptComposerRef = useRef<ScriptComposerState | null>(null);
  const [scriptComposer, setScriptComposer] =
    useState<ScriptComposerState | null>(null);
  // Live drive listing (increment (b)): only dispatched once the composer
  // is actually open AND no static `scriptPaths` config already supplies a
  // list, so every test/usage that configures a static list (increment
  // (a)'s fixtures) never touches the real executeScript RPC. A config
  // list, when present, wins outright over the live listing rather than
  // merging with it.
  const liveListing = useKosScriptListing(
    coreId,
    cpuTag,
    scriptComposer !== null && scriptPaths.length === 0,
  );
  const effectiveScriptPaths =
    scriptPaths.length > 0 ? scriptPaths : liveListing.paths;
  const scriptListHint = scriptPaths.length > 0 ? null : liveListing.hint;
  // scriptPaths can change at runtime (increment (b)'s live drive listing),
  // read via ref for the same mount-only-closure reason as `lineModeRef`.
  const scriptPathsRef = useRef<string[]>(effectiveScriptPaths);
  scriptPathsRef.current = effectiveScriptPaths;
  const scriptListboxId = useId();
  // lineMode can flip at runtime (a config edit) and must NOT tear down the
  // live xterm: the onData handler reads this ref per keystroke instead of
  // capturing lineMode in its setup effect, so the running terminal (and its
  // on-screen content) survives the switch. Clear any in-progress composition
  // (and history-browse position) on a mode change so a stale line doesn't
  // linger in the bar.
  const lineModeRef = useRef(lineMode);
  lineModeRef.current = lineMode;
  // Mirrors `noPath` (computed further down, once `connectivity` is read) for
  // the same reason as `lineModeRef`: the Enter handler lives inside the
  // mount-only xterm setup effect below, so it can't close over a fresh
  // `noPath` each render, it reads this ref instead. Declared here (ahead of
  // `noPath`) so the assignment site next to `noPath` itself reads as the
  // natural "keep this ref current" companion, matching `sendKeystrokeRef`'s
  // own reassign-every-render pattern just below (kos-nopath-block-input fix).
  const noPathRef = useRef(false);
  // Intentionally keyed on lineMode: this effect exists to clear the
  // composition WHEN the mode flips, not to react to values it reads.
  // biome-ignore lint/correctness/useExhaustiveDependencies: lineMode is the trigger, not a read dependency
  useEffect(() => {
    lineBufferRef.current = EMPTY_COMPOSITION;
    setComposition(EMPTY_COMPOSITION);
    historyIndexRef.current = null;
    historyDraftRef.current = "";
    scriptComposerRef.current = null;
    setScriptComposer(null);
  }, [lineMode]);
  // Keep xterm's own cursor blink in sync with which surface owns input,
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

  // `comms.delay`/`comms.link` are read through `useLatestValue`, NOT the
  // certainty-gated `useStream`/`useViewUt` path: comms.delay is TrueNow
  // command-centre bookkeeping; comms.link is Delayed but freeze-EXEMPT, so
  // useLatestValue reads its most-recent arrived frame (the link edge at the
  // light-time horizon) directly. `oneWaySeconds` is nullable, null when
  // there is no measurable ControlPath, as opposed to 0 for the delay-
  // feature-disabled-but-connected case (comms-delay-nullable-when-no-path
  // fix). Both read as "nothing to show" below, same as the pre-fix 0
  // sentinel did.
  const commsDelay = useLatestValue<{ oneWaySeconds: number | null }>(
    "comms.delay",
  );

  // The in-transit strip's PURE prediction fuel, scoped to this terminal's
  // own CPU (`terminalTopic`): the shared delayed-command-ux primitive
  // (`@ksp-gonogo/sitrep-sdk`'s `useRouteCommands`), which reads
  // `system.uplink.pending`/the real-time view clock the same
  // delay-consistent way this terminal always has, plus the judder-latch
  // (`kos-terminal-arrow-judder` fix) this terminal's own `isPastReach`
  // used to hand-roll. Nothing here is ever read for anything
  // execution/result-shaped: the payload has no such field, and a row
  // disappears only because the engine pruned it from a later snapshot,
  // never because this widget decided a command "completed".
  const { items: routeItems, mode: routeMode } =
    useRouteCommands(terminalTopic);

  // Whether the ground station has a path to the craft; read off the
  // client-facing `comms.link` connectivity MetaTopic (the de-publicised
  // TrueNow `comms.connectivity` successor; comms-delay-model-consistency
  // spec). comms.link is Delayed + freeze-EXEMPT, so its disconnect edge
  // reveals at the light-time horizon: delay-consistent with this terminal's
  // own (delayed) screen rather than a real-time TrueNow read. `undefined` (no
  // link data yet) is treated as connected: only a CONFIRMED `connected ===
  // false` blocks a send / shows the warning below.
  const connectivity = useLatestValue<CommsLink>("comms.link");
  const noPath = connectivity?.connected === false;
  noPathRef.current = noPath;

  // Uplink commands. Each `send` is a stable useCallback (keyed by command),
  // destructured so effects can depend on it without the surrounding
  // per-render `{send,status}` object re-triggering them. The imperative xterm
  // handlers call the latest sender via refs.
  const keystrokeCmd = useCommand("kos.keystroke");
  const openCmd = useCommand("kos.terminal.open");
  const closeCmd = useCommand("kos.terminal.close");
  const resizeCmd = useCommand("kos.terminal.resize");
  const { send: sendKeystroke } = keystrokeCmd;
  const { send: sendOpen } = openCmd;
  const { send: sendClose } = closeCmd;
  const { send: sendResize } = resizeCmd;

  // The kOS terminal IS its own signal-delay UX: the xterm echoes each
  // keystroke only after the full round trip, so the delay shows as the
  // terminal's own latency (the terminal-fidelity model), NOT a per-keystroke
  // `<CommandDelay>` in-flight list, which would fight that surface. So this
  // component self-consumes its four terminal-control commands' must-consume
  // tokens, the same truthful self-consume `useControlStream` does for the
  // continuous stream it renders itself. Dev only; `_output` is absent in prod.
  useEffect(() => {
    if (process.env.NODE_ENV === "production") return;
    for (const cmd of [keystrokeCmd, openCmd, closeCmd, resizeCmd]) {
      if (cmd._output) cmd._output.consumed = true;
    }
  });

  // `label` is only ever non-empty for a line-mode Enter (the composed line
  // IS the label, see `reduceLineModeInput`'s callsite below); char-mode
  // keystrokes stay label-less. Purely cosmetic on the wire, it plays no
  // role in dispatch/correlation and never feeds the prediction-only strip
  // beyond what the server already echoed back onto the pending-queue entry.
  //
  // Blocks the dispatch outright when `noPath` (a confirmed
  // `comms.connectivity.connected === false`): the server used to silently
  // drop a command sent with no line of sight; blocking client-side instead
  // means the operator sees why nothing happened (the "No path" warning
  // below) rather than a command vanishing into a queue that will never
  // move. Char-mode keystrokes are blocked the same way as a line-mode
  // Enter: the CPU is equally unreachable either way.
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
    // telnet NAWS-once pattern): no dynamic fit-to-pixels. See KOS_TERM_*.
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

  // xterm setup: deferred until the container has real layout so the first
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
        fontSize: TERMINAL_FONT_PX,
        // Line mode hands the active caret to `CompositionBar` (its own
        // blinking cursor sits on the composed line); leaving xterm's native
        // cursor ALSO blinking at the last-painted `kOS>` position reads as
        // two disagreeing cursors. Suppress it whenever the bar owns input,
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
          // `/`-script composer: while active it owns input exclusively,
          // ahead of the ordinary history/cursor/typing handling below
          // (kos-terminal-script-picker). Ctrl+C cancels the composer AND
          // still forwards the interrupt, same as it does for an ordinary
          // in-progress line further down.
          if (scriptComposerRef.current !== null) {
            if (data === "\x03") {
              scriptComposerRef.current = null;
              setScriptComposer(null);
              sendKeystrokeRef.current("\x03", "^C");
              return;
            }
            const action = handleScriptComposerInput(
              data,
              scriptComposerRef.current,
              scriptPathsRef.current,
            );
            if (action.kind === "update") {
              scriptComposerRef.current = action.next;
              setScriptComposer(action.next);
            } else if (action.kind === "cancel") {
              scriptComposerRef.current = null;
              setScriptComposer(null);
            } else if (action.kind === "send") {
              // Refuses the send with no comms path, same as
              // `reduceLineModeChar`'s `canSend` guard for an ordinary
              // line: leaves the composer exactly as-is so the operator
              // can finish once the path returns, instead of losing the
              // pending RUNPATH (kos-nopath-block-input parity).
              if (!noPathRef.current) {
                scriptComposerRef.current = null;
                setScriptComposer(null);
                lineHistoryRef.current = pushLineHistory(
                  lineHistoryRef.current,
                  action.label,
                );
                sendKeystrokeRef.current(action.chars, action.label);
              }
            }
            return;
          }
          // "/" at the very start of an empty line opens the script
          // composer instead of typing a literal slash; never mid-line, so
          // a "/" inside a path argument elsewhere in a command still types
          // normally.
          if (
            data === "/" &&
            lineBufferRef.current.text === "" &&
            lineBufferRef.current.cursor === 0
          ) {
            const next: ScriptComposerState = {
              phase: "picking",
              query: "",
              activeIndex: -1,
            };
            scriptComposerRef.current = next;
            setScriptComposer(next);
            return;
          }
          // Up-arrow: recall history, one entry further into the past.
          if (data === "\x1b[A") {
            if (historyIndexRef.current === null) {
              historyDraftRef.current = lineBufferRef.current.text;
            }
            const nav = recallOlder(
              lineHistoryRef.current,
              historyIndexRef.current,
            );
            if (nav) {
              historyIndexRef.current = nav.index;
              // History recall replaces the whole line, the cursor lands at
              // its end, matching shell recall conventions.
              const recalled: LineComposition = {
                text: nav.value,
                cursor: nav.value.length,
              };
              lineBufferRef.current = recalled;
              setComposition(recalled);
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
              const recalled: LineComposition = {
                text: nav.value,
                cursor: nav.value.length,
              };
              lineBufferRef.current = recalled;
              setComposition(recalled);
            }
            return;
          }
          // Left/Right-arrow: move the composition cursor without touching
          // the text: clamped at both ends by `moveCursor`.
          if (data === "\x1b[D" || data === "\x1b[C") {
            const moved = moveCursor(
              lineBufferRef.current,
              data === "\x1b[D" ? -1 : 1,
            );
            lineBufferRef.current = moved;
            setComposition(moved);
            return;
          }
          // Home/End: jump the cursor to the start/end of the composed line.
          if (data === "\x1b[H" || data === "\x1b[F") {
            const moved =
              data === "\x1b[H"
                ? cursorToStart(lineBufferRef.current)
                : cursorToEnd(lineBufferRef.current);
            lineBufferRef.current = moved;
            setComposition(moved);
            return;
          }
          // Delete (forward-delete): remove the character AT the cursor.
          if (data === "\x1b[3~") {
            const next = deleteForward(lineBufferRef.current);
            lineBufferRef.current = next;
            setComposition(next);
            return;
          }
          // Ctrl+C: clear the in-progress line locally AND forward the
          // interrupt itself so a running kOS program actually breaks, this
          // is a control signal, not a composed line, so it never joins line
          // history.
          if (data === "\x03") {
            historyIndexRef.current = null;
            lineBufferRef.current = EMPTY_COMPOSITION;
            setComposition(EMPTY_COMPOSITION);
            sendKeystrokeRef.current("\x03", "^C");
            return;
          }
          // Any regular edit leaves history-browse mode: recalling a line
          // then typing continues editing it as the new live draft.
          historyIndexRef.current = null;
          const next = reduceLineModeInput(
            data,
            lineBufferRef.current,
            // `chars` carries the trailing `\r` `reduceLineModeChar` appends
            // for the wire (kOS needs the Enter byte); the label is the
            // operator-facing composed line, so it's trimmed of that
            // control character: the queue strip renders the label
            // verbatim and must not show a raw CR.
            (chars) => {
              const label = chars.replace(/[\r\n]+$/, "");
              lineHistoryRef.current = pushLineHistory(
                lineHistoryRef.current,
                label,
              );
              sendKeystrokeRef.current(chars, label);
            },
            // Refuses Enter at the point the line would otherwise be
            // committed, the fix for kos-nopath-block-input: with no comms
            // path, this keeps the buffer untouched (no clear, no history
            // push) instead of relying on the dispatch-layer guard below,
            // which by then is too late to save the typed line. Read via the
            // ref (not `noPath` directly) for the same mount-only-closure
            // reason as `lineModeRef` throughout this handler.
            !noPathRef.current,
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
  // mutually exclusive: never both. A read-only viewer in line mode with a
  // long delay gets neither (it dispatches no commands, so nothing to queue).
  const showBadge =
    commsDelay !== undefined &&
    (commsDelay.oneWaySeconds ?? 0) > 0 &&
    (!lineMode || (commsDelay.oneWaySeconds ?? 0) <= 1);
  // `routeMode === "staged"` is exactly the `oneWaySeconds != null && > 1`
  // threshold `currentMode` applies, equivalent to the old raw check, minus
  // the redundant `commsDelay !== undefined` (folded into "staged" itself).
  const showStrip = lineMode && !readOnly && routeMode === "staged";
  // Narrowed, non-optional local for the JSX below, `showBadge` is a plain
  // boolean, so TS can't carry its truthiness back onto `commsDelay` at the
  // read site; only-render-when-defined instead.
  const badgeDelay = showBadge ? commsDelay : undefined;
  // The in-transit strip's display shape: reach-leg items count down to
  // reaching the craft (↑), everything else counts down to the reply (↓),
  // `InFlightList` picks the arrow from `phase` itself.
  const stripItems: InFlightListItem[] = routeItems.map((item) => ({
    id: item.id,
    label: item.label || item.command,
    etaSeconds:
      item.predictedPhase === "in-transit"
        ? item.reachEtaSeconds
        : item.replyEtaSeconds,
    phase: item.predictedPhase,
  }));

  // Filtered/grouped options for the `/`-script composer's dropdown, kept
  // in the SAME order `handleScriptComposerInput` computes for activeIndex
  // math (`scriptOptionsFor`), so the highlighted row always matches what
  // Enter would pick.
  const scriptListing =
    scriptComposer?.phase === "picking"
      ? scriptOptionsFor(effectiveScriptPaths, scriptComposer.query)
      : null;
  const scriptActiveIndex =
    scriptComposer?.phase === "picking" ? scriptComposer.activeIndex : -1;

  const roundTrip = value("s", 2 * (badgeDelay?.oneWaySeconds ?? 0));

  return (
    <TerminalShell>
      <TerminalFrame>
        <Container ref={containerRef} $readOnly={readOnly} />
        {badgeDelay && (
          <DelayBadge role="status" aria-label="Signal delay">
            round-trip ~
            {/* `scale: "never"` and a decimal, because a delay is a READOUT
                rather than a countdown: the time ladder truncates to whole
                units, so 7.6s would read as "7s". Above a minute the decimal
                is noise and the ladder takes over. */}
            <Unit
              value={roundTrip}
              {...(roundTrip.magnitude < 60
                ? { scale: "never" as const, decimals: 1 }
                : {})}
            />
          </DelayBadge>
        )}
        {/* Pinned inside `TerminalFrame`'s own bordered box, same as
            `DelayBadge` above: a flex sibling below the frame (its previous
            spot) added its own row height on top of everything else in
            `TerminalShell`, which could push later siblings (the composition
            bar) past the widget's visible bounds on a short widget. See
            `TerminalFrame`'s doc comment for the same reasoning applied to
            `DelayBadge` originally. */}
        {!readOnly && noPath && (
          <NoPathBadge role="status">
            No path: commands are not being sent
          </NoPathBadge>
        )}
        {onChangeCpu && (
          <ChangeCpuButton type="button" onClick={onChangeCpu}>
            <ComputerIcon />
            Change CPU
          </ChangeCpuButton>
        )}
      </TerminalFrame>
      {showStrip && (
        <InFlightList items={stripItems} ariaLabel="Uplink queue" />
      )}
      {lineMode && !readOnly && (
        <CompositionBarWrap>
          <CompositionBar
            role="group"
            aria-label={scriptComposer ? "Run script" : "Line-mode input"}
            $noPath={noPath}
          >
            <CompositionBar__Prompt aria-hidden="true">
              ❯
            </CompositionBar__Prompt>
            <CompositionBar__Text>
              {scriptComposer ? (
                scriptComposer.phase === "picking" ? (
                  <>
                    /{scriptComposer.query}
                    <CompositionBar__Cursor aria-hidden="true" />
                  </>
                ) : (
                  <>
                    {scriptComposer.path} {scriptComposer.argsText}
                    <CompositionBar__Cursor aria-hidden="true" />
                  </>
                )
              ) : (
                <>
                  {composition.text.slice(0, composition.cursor)}
                  <CompositionBar__Cursor aria-hidden="true" />
                  {composition.text.slice(composition.cursor)}
                </>
              )}
            </CompositionBar__Text>
          </CompositionBar>
          {scriptComposer?.phase === "args" && (
            <ScriptComposerOptions>
              <Switch
                checked={scriptComposer.copyLocal}
                onChange={(checked) => {
                  if (scriptComposerRef.current?.phase !== "args") return;
                  const next: ScriptComposerState = {
                    ...scriptComposerRef.current,
                    copyLocal: checked,
                  };
                  scriptComposerRef.current = next;
                  setScriptComposer(next);
                }}
                label="Copy local & run (Ctrl+L)"
              />
            </ScriptComposerOptions>
          )}
          {scriptListing && (
            <ComboboxListbox
              id={scriptListboxId}
              ariaLabel="Script picker"
              groups={scriptListing.groups}
              flatOptions={scriptListing.flat}
              activeIndex={scriptActiveIndex}
              getOptionId={(key) => `${scriptListboxId}-${key}`}
              onHoverIndex={(index) => {
                if (scriptComposerRef.current?.phase !== "picking") return;
                const next: ScriptComposerState = {
                  ...scriptComposerRef.current,
                  activeIndex: index,
                };
                scriptComposerRef.current = next;
                setScriptComposer(next);
              }}
              onSelectKey={(key) => {
                const next: ScriptComposerState = {
                  phase: "args",
                  path: key,
                  argsText: "",
                  copyLocal: false,
                };
                scriptComposerRef.current = next;
                setScriptComposer(next);
              }}
              emptyLabel={scriptListHint ?? "No scripts found"}
            />
          )}
          {/* A second, compact "NO PATH" flag pinned right on the bar the
              operator is actually looking at while typing, the existing
              `NoPathBadge` above sits in the terminal pane's corner, which is
              easy to miss when attention is on the input line, and the
              error-tone outline alone (`CompositionBar`'s `$noPath` border)
              doesn't say WHY the box turned red. Distinct, shorter text from
              `NoPathBadge`'s so `getByText`-style queries for either can't
              collide. `role="status"` (not `alert`): connectivity loss is an
              ambient condition to note, not an interrupting emergency. */}
          {noPath && (
            <CompositionBar__NoPathFlag role="status">
              NO PATH
            </CompositionBar__NoPathFlag>
          )}
        </CompositionBarWrap>
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
          When on, keystrokes are not forwarded, the terminal is a passive
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
  owner: KOS,
});

export { KosTerminalComponent };

const TerminalShell = styled.div`
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  min-height: 0;
  gap: var(--space-6);
`;

// Wraps the terminal pane so the delay badge can be pinned INSIDE its
// bordered box (an absolutely-positioned corner overlay) instead of floating
// below it as a separate flex sibling, a badge floating past the pane's own
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
  border-radius: var(--radius-md);
  overflow: hidden;
  box-sizing: border-box;

  /* xterm.js mounts a child div: make it fill the container */
  .xterm {
    height: 100%;
    padding: var(--space-8);
  }
  /* Must stay the same rung as the container radius above: it clips xterm's
     own scroll surface to the outer bordered box. */
  .xterm-viewport {
    border-radius: var(--radius-md);
  }
`;

// Positioning context for `CompositionBar__NoPathFlag` below, pinned to the
// bar itself rather than floating as its own flex row, takes over the
// `flex: 0 0 auto` sizing `CompositionBar` used to own directly as a
// `TerminalShell` child, so the bar's own height/width is unaffected by the
// wrap (a plain block box hugs its sole child's size).
const CompositionBarWrap = styled.div`
  position: relative;
  flex: 0 0 auto;
`;

// The "copy local & run" toggle (increment (b)), shown only while the
// `/`-composer is in "args" phase, a compact row under the bar rather than
// crowding it, matching the composition bar's own font sizing.
const ScriptComposerOptions = styled.div`
  display: flex;
  align-items: center;
  padding: var(--space-2) var(--space-4) 0;
  font-size: var(--font-size-xs);
`;

// Line-mode input bar: the operator's in-progress composition, kept OFF the
// server-authoritative terminal screen so absolutely-positioned frames can
// never collide with it. Cleared on Enter (the line is sent; kOS's own echo
// lands in the terminal above a round-trip later), or, with no comms path,
// left untouched and Enter refused (`reduceLineModeChar`'s `canSend` guard).
// The outline itself carries that state: the same error/danger tone as
// `NoPathBadge` (`--color-status-nogo-fg`) replaces the normal accent border
// whenever `noPath`, so the box reads as blocked on sight, not just after a
// refused Enter: instead of staying green (kos-nopath-block-input fix).
const CompositionBar = styled.div<{ $noPath: boolean }>`
  display: flex;
  align-items: center;
  padding: var(--space-6) var(--space-8);
  /* 1.6em, i.e. relative to TERMINAL_FONT_PX below, not to a token. */
  min-height: 1.6em;
  background: var(--color-surface-panel);
  border: 1px solid
    ${({ $noPath }) =>
      $noPath ? "var(--color-status-nogo-fg)" : "var(--color-accent-fg)"};
  border-radius: var(--radius-md);
  font-family: monospace;
  /* Locked to xterm's own fontSize option; see TERMINAL_FONT_PX. */
  font-size: ${TERMINAL_FONT_PX}px;
  box-sizing: border-box;
`;

// Compact "NO PATH" flag pinned to the top edge of the composition bar
// itself: see the render-site comment for why this exists alongside the
// pre-existing `NoPathBadge` in the terminal pane's corner. Absolutely
// positioned against `CompositionBarWrap`, so it never affects the bar's own
// layout/height (and therefore never shifts anything below it in
// `TerminalShell`).
const CompositionBar__NoPathFlag = styled.div`
  position: absolute;
  /* -9px is hand-computed against this flag's OWN rendered height (~16px), so
     that it straddles the top border of CompositionBarWrap. Every value
     that feeds that height therefore stays literal with it: the 10px font
     (--font-size-2xs is 11px under @media (pointer: coarse), i.e. on the
     tier-1 Steam Deck, which grows the flag while -9px stays put) and the
     vertical padding beside it. Recompute the -9px if any of them moves. */
  top: -9px;
  right: var(--space-8);
  /* Local ordering only: this flag just has to sit over the composition bar
     it is pinned to. Not app-global chrome, so not on the --z-* ladder. */
  z-index: 1;
  padding: 1px 6px;
  font-family: monospace;
  font-size: 10px;
  font-weight: bold;
  letter-spacing: 0.04em;
  color: var(--color-status-nogo-on-bg);
  background: var(--color-status-nogo-bg);
  border: 1px solid var(--color-status-nogo-on-bg);
  border-radius: var(--radius-md);
`;

// No gap here: the cursor block must sit flush against the trailing
// character of `CompositionBar__Text`, not offset by a flex gap (that read
// as the cursor sitting one character off the actual trailing character).
// The prompt keeps its own breathing room via `margin-right` instead of a
// container-wide `gap` that would otherwise apply between every child.
const CompositionBar__Prompt = styled.span`
  color: var(--color-accent-fg);
  font-weight: bold;
  margin-right: var(--space-8);
`;

const CompositionBar__Text = styled.span`
  color: var(--color-text-primary);
  white-space: pre-wrap;
  word-break: break-all;
`;

const CompositionBar__Cursor = styled.span`
  display: inline-block;
  /* em-relative against TERMINAL_FONT_PX, so the caret block keeps matching
     the terminal's cell. Converting either to px severs that. */
  width: 0.6em;
  height: 1.1em;
  background: var(--color-accent-fg);
  vertical-align: text-bottom;

  @media (prefers-reduced-motion: no-preference) {
    /* Both literal: 1s is a 1Hz caret, a physical rate rather than a UI
       transition, and step-end is what makes it a hard blink instead of a
       fade. Neither belongs on the motion scale. The shorthand stays INSIDE
       the reduced-motion guard with its keyframes. */
    animation: kos-caret-blink 1s step-end infinite;
  }

  @keyframes kos-caret-blink {
    50% {
      opacity: 0;
    }
  }
`;

// Steady-state warning while `comms.link.connected === false`: a
// confirmed line-of-sight loss, not merely "no link data yet" (see
// `noPath`'s own doc comment). Error/danger tone (the same
// `--color-status-nogo-*` pair `CommSignal` uses for its "lost" state) so it
// reads unambiguously as a blocking condition, not an informational badge
// like `DelayBadge` below it. Pinned as an absolutely-positioned corner
// overlay INSIDE `TerminalFrame`: same fix, same reasoning as `DelayBadge`
// (see its own doc comment): as a flex sibling in `TerminalShell` this added
// its own row height on top of the composition bar beneath it, which could
// push that bar past the widget's visible bounds on a short widget instead
// of staying within the terminal's own bordered box (kos-nopath-block-input
// fix). Opposite corner from `DelayBadge` so the two never overlap on the
// (rare) render where both are showing: a stale delay reading can still be
// latched (see `delay-authority.ts`) through a connectivity drop, so both
// badges legitimately co-render. "Opposite corner" alone isn't enough at
// narrow widths (e.g. the widget's own registered minSize, 8x6): this
// badge's text is the longer of the two, and with no width cap it grows
// straight across the frame into `DelayBadge`'s corner instead of stopping
// short. Capped + truncated so it always leaves `DelayBadge` clear instead
// of visually colliding with it.
const NoPathBadge = styled.div`
  position: absolute;
  top: var(--space-8);
  left: var(--space-8);
  /* Local ordering inside TerminalFrame only; see CompositionBar__NoPathFlag. */
  z-index: 1;
  padding: var(--space-2) var(--space-8);
  font-family: monospace;
  font-size: var(--font-size-xs);
  font-weight: bold;
  color: var(--color-status-nogo-on-bg);
  background: var(--color-status-nogo-bg);
  border: 1px solid var(--color-status-nogo-on-bg);
  border-radius: var(--radius-md);
  max-width: 50%;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
`;

// Compact delay readout: char-mode always, line-mode only when the delay is
// too short (<=1s one-way) for a strip to be worth it; see `showBadge`.
// Pinned as an absolutely-positioned corner overlay INSIDE `TerminalFrame`
// (a sibling of `Container`, not a descendant, `Container`'s own
// `overflow: hidden` is reserved for xterm's content) rather than a flex
// item below the terminal pane, so it always renders within the terminal's
// own bordered box instead of floating past it.
const DelayBadge = styled.div`
  position: absolute;
  top: var(--space-8);
  right: var(--space-8);
  /* Local ordering inside TerminalFrame only; see CompositionBar__NoPathFlag. */
  z-index: 1;
  padding: var(--space-2) var(--space-8);
  font-family: monospace;
  font-size: var(--font-size-xs);
  color: var(--color-text-muted);
  background: var(--color-surface-panel);
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-md);
`;

const CpuPicker = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-8);
  align-items: center;
  padding: var(--space-12);
`;

// Larger, icon-leading CPU buttons (2026-07-15 feedback: the bare picker read
// as "drab"). Composes the ui-kit GhostButton, enlarging its hit area and
// pairing the label with a decorative computer icon.
const CpuPicker__Button = styled(GhostButton)`
  display: inline-flex;
  align-items: center;
  gap: var(--space-6);
  padding: var(--space-8) var(--space-12);
  font-size: var(--font-size-lg);
`;

// "Change CPU": pinned as an absolutely-positioned corner overlay INSIDE
// `TerminalFrame` (same pattern + reasoning as `DelayBadge`/`NoPathBadge`), in
// the bottom-right corner the badges leave free, so it never adds a flex row
// that could push the composition bar past the widget's visible bounds.
const ChangeCpuButton = styled(GhostButton)`
  position: absolute;
  bottom: var(--space-8);
  right: var(--space-8);
  /* Local ordering inside TerminalFrame only, same as DelayBadge/NoPathBadge:
     lift this overlay above xterm's own layers in the Container beneath it.
     Not app-global chrome, so a named z rung would be wrong here. */
  z-index: 1;
  display: inline-flex;
  align-items: center;
  gap: var(--space-6);
  font-size: var(--font-size-xs);
`;
