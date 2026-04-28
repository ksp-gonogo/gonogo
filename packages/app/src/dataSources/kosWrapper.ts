import type { KosScriptArg } from "@gonogo/data";

/**
 * Per-dispatch wrapper that keeps the on-volume copy of a widget's
 * kerboscript in sync with the bundled source. The wrapper checks a
 * sidecar `.ver` file; if it doesn't match the bundled hash it deletes
 * the old `.ks` + `.ver`, rewrites them line-by-line, then RUNPATHs
 * the script. Costs one EXISTS + READALL on the steady state.
 *
 * Wire cost: the bundled body is embedded in the wrapper text every
 * dispatch, so every executeScript pays the body's byte cost on the
 * wire. For ShipMap (~5KB) at command-mode dispatch rates that's
 * negligible; if interval-mode kOS widgets ever push this past a
 * problem, switch to a session-level "we synced this version already"
 * cache.
 */
export interface BuildKosWrapperOptions {
  /** Target kerboscript path on the kOS volume, e.g. "0:/widget_scripts/shipmap.ks". */
  path: string;
  /** Bundled script body (the same text users used to copy-paste). */
  body: string;
  /** Stable hash of `body`. Stored in `<path>.ver`; mismatch triggers rewrite. */
  version: string;
  /** Args to forward to RUNPATH. */
  args: KosScriptArg[];
}

const VERSION_SUFFIX = ".ver";

/**
 * Build the per-dispatch wrapper kerboscript. Pure — no I/O, no state.
 *
 * The wrapper layout deliberately keeps the steady-state path tiny: an
 * EXISTS+READALL+TRIM+equality check, then RUNPATH. Only the
 * one-time-per-version branch carries the LOG storm.
 */
export function buildKosWrapper(opts: BuildKosWrapperOptions): string {
  const { path, body, version, args } = opts;
  const verPath = `${path}${VERSION_SUFFIX}`;
  const lines = body.split("\n");
  const argList = [quoteKosString(path), ...args.map(formatArg)].join(", ");

  const out: string[] = [
    `// gonogo wrapper for ${quoteKosString(path)} v=${quoteKosString(version)}`,
    `LOCAL targetPath IS ${quoteKosString(path)}.`,
    `LOCAL versionPath IS ${quoteKosString(verPath)}.`,
    `LOCAL bundledVersion IS ${quoteKosString(version)}.`,
    "",
    "LOCAL needsWrite IS TRUE.",
    "IF EXISTS(targetPath) AND EXISTS(versionPath) {",
    "  LOCAL existing IS OPEN(versionPath):READALL:STRING.",
    "  IF existing:TRIM = bundledVersion { SET needsWrite TO FALSE. }",
    "}",
    "",
    "IF needsWrite {",
    `  PRINT "wrapper: rewriting " + targetPath + " v=" + bundledVersion.`,
    "  IF EXISTS(targetPath) { DELETEPATH(targetPath). }",
    "  IF EXISTS(versionPath) { DELETEPATH(versionPath). }",
    ...lines.map((line) => `  LOG ${quoteKosString(line)} TO targetPath.`),
    "  LOG bundledVersion TO versionPath.",
    "}",
    "",
    `RUNPATH(${argList}).`,
  ];
  return `${out.join("\n")}\n`;
}

/**
 * Sentinels the kOS data-source parser keys off. The wrapper's source is
 * echoed verbatim by the kOS REPL on dispatch, so any contiguous
 * `[KOSDATA]…[/KOSDATA]` (or KOSERROR) byte sequence in the wrapper text
 * — even inside a string literal — gets matched by the parser BEFORE
 * the actual script runs. That captures the wrapper's source as the
 * widget's payload and the real script's [KOSDATA] never lands.
 *
 * Defeating it is purely a wire-bytes concern: `splitSentinels` breaks
 * each occurrence after the leading `[`, so the resulting pieces concat
 * to the same runtime string but no sentinel appears intact in the
 * source.
 */
const PARSER_SENTINELS = [
  "[KOSDATA]",
  "[/KOSDATA]",
  "[KOSERROR]",
  "[/KOSERROR]",
];

function splitSentinels(s: string): string[] {
  let pieces: string[] = [s];
  for (const sentinel of PARSER_SENTINELS) {
    const next: string[] = [];
    for (const piece of pieces) {
      let remaining = piece;
      while (true) {
        const idx = remaining.indexOf(sentinel);
        if (idx < 0) {
          if (remaining.length > 0) next.push(remaining);
          break;
        }
        // Split after the `[` so neither piece contains the sentinel.
        // "...x[KOSDATA]y..." → ["...x[", "KOSDATA]y..."]
        next.push(remaining.slice(0, idx + 1));
        remaining = remaining.slice(idx + 1);
      }
    }
    pieces = next;
  }
  return pieces;
}

/**
 * Quote a JS string as a kOS string-concat expression. kOS has no escape
 * syntax — embed `"` via `CHAR(34)`, and break parser sentinels via the
 * piece-split above. Output is a kerboscript expression that evaluates
 * to `s` at runtime but never contains an intact sentinel byte sequence
 * in its source.
 */
function quoteKosString(s: string): string {
  if (s === "") return `""`;
  const pieces = splitSentinels(s);
  if (pieces.length === 0) return `""`;
  return pieces.map(encodeQuotedPiece).join(" + ");
}

function encodeQuotedPiece(s: string): string {
  if (s === "") return `""`;
  if (!s.includes(`"`)) return `"${s}"`;
  return s
    .split(`"`)
    .map((fragment) => `"${fragment}"`)
    .join(" + CHAR(34) + ");
}

function formatArg(arg: KosScriptArg): string {
  if (typeof arg === "number") return String(arg);
  if (typeof arg === "boolean") return arg ? "true" : "false";
  return quoteKosString(arg);
}
