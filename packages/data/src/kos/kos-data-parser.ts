/**
 * Parser for the `[KOSDATA] k=v;k=v [/KOSDATA]` wire format that kOS widget
 * scripts MUST emit on stdout. Pure function, no I/O.
 *
 * The input is any chunk of kOS terminal output — the parser locates the
 * marker pair, parses the key/value body, and returns an object. Text
 * outside the markers (REPL prompt, RUN echo, stray PRINTs) is ignored.
 *
 * If the chunk contains multiple `[KOSDATA] … [/KOSDATA]` blocks, the last
 * one wins. That matches the intended contract: scripts emit exactly one,
 * so if we see more than one the later one is always newer.
 */

import { PerfBudget } from "@gonogo/core";

/**
 * Soft cap on parser invocations. The proxy emits one PTY chunk per
 * line of kOS output; with multiple kOS widgets polling every few
 * seconds, expect ~10–30/sec under normal load. Threshold at 200/sec
 * catches infinite-loop scripts or runaway kOS PRINTs that would flood
 * the parse pipeline.
 */
const KOS_PARSE_BUDGET = new PerfBudget({
  name: "kos-data-parser.parseKosData calls/sec",
  threshold: 200,
  windowMs: 1000,
  unit: "calls",
});

export type KosDataValue = number | boolean | string;
export type KosData = Record<string, KosDataValue>;

/** Runtime-resolved arg value passed to a kOS compute data source. */
export type KosScriptArg = number | string | boolean;

const BLOCK_RE = /\[KOSDATA\]([\s\S]*?)\[\/KOSDATA\]/g;

/**
 * Strip ANSI control sequences. kOS's GUI repaint emits screen contents
 * with a cursor-position escape (`ESC [ row ; col H`) injected at every
 * terminal line wrap, which can split our `[KOSDATA]` marker — observed
 * in the wild as `[/KOSDA<ESC[22;1H>TA]`. Stripping these BEFORE the
 * marker scan makes the parser robust to wrapping across PTY rows.
 *
 * Sequences covered:
 *   - CSI: `ESC [ params final-byte`
 *   - OSC: `ESC ] ... BEL` (title-set, etc.)
 *   - Bare 2-byte escapes: `ESC <letter>` or `ESC ?` etc.
 */
const ANSI_RE =
  // biome-ignore lint/suspicious/noControlCharactersInRegex: stripping ANSI is the whole point
  /\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[@-Z\\-_?]/g;

export function stripAnsi(text: string): string {
  // Most plain-PRINT chunks have no escape character; the indexOf check
  // is roughly an order of magnitude cheaper than running the regex
  // `replace` blindly. Worth doing because parseKosData is called per
  // PTY chunk during active kOS widget polling.
  if (text.indexOf("\x1b") === -1) return text;
  return text.replace(ANSI_RE, "");
}

/**
 * Returns the parsed key/value object from the last `[KOSDATA]` block in
 * `text`, or null if no complete block is present.
 */
export function parseKosData(text: string): KosData | null {
  KOS_PARSE_BUDGET.record();
  const clean = stripAnsi(text);
  let lastBody: string | null = null;
  // Reset lastIndex each call — BLOCK_RE is module-scoped.
  BLOCK_RE.lastIndex = 0;
  let match = BLOCK_RE.exec(clean);
  while (match !== null) {
    lastBody = match[1];
    match = BLOCK_RE.exec(clean);
  }
  if (lastBody === null) return null;
  return parseBody(lastBody);
}

function parseBody(body: string): KosData {
  const out: KosData = {};
  for (const raw of body.split(";")) {
    const eq = raw.indexOf("=");
    if (eq === -1) continue;
    const key = raw.slice(0, eq).trim();
    if (key === "") continue;
    const value = raw.slice(eq + 1).trim();
    out[key] = coerce(value);
  }
  return out;
}

function coerce(value: string): KosDataValue {
  if (value === "true") return true;
  if (value === "false") return false;
  // Must accept things like "-1.5", "3e-2", "0". Rejects "NaN" (ambiguous —
  // we'd rather surface it as a string so the widget can decide).
  if (value !== "" && /^-?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(value)) {
    return Number(value);
  }
  return value;
}
