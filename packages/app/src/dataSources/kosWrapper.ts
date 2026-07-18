import type { KosManagedScript, KosScriptArg } from "@ksp-gonogo/kos";

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
 * History of approaches and why each failed (don't repeat):
 *   - Top-level `LOCAL needsWrite IS TRUE.` — LOCALs don't persist
 *     across statement boundaries at the REPL, so `IF needsWrite { }`
 *     errored with "Undefined Variable Name 'needswrite'".
 *   - Wrap in `FUNCTION gonogoWrapperEnsure { ... }` — kOS REPL keeps
 *     prior FUNCTION definitions cached and ignores re-definitions.
 *     Adding a 4th `bodyText` parameter caused the cached 3-parameter
 *     version to reject calls with "Number of arguments ... Called
 *     with too many arguments."
 *
 * Current approach: use plain `SET` assignments at REPL top level.
 * `@LAZYGLOBAL on` is the REPL default, so SET on an undeclared name
 * creates a real global that persists across statements. Names get
 * a `gonogoWrapper` prefix so they don't collide with whatever a
 * user has set up in their session.
 *
 * Steady-state path is tiny: EXISTS + READALL + TRIM + equality
 * check, then RUNPATH. Only the one-time-per-version branch carries
 * the LOG storm.
 */
export function buildKosWrapper(opts: BuildKosWrapperOptions): string {
  const { path, body, version, args } = opts;
  const verPath = `${path}${VERSION_SUFFIX}`;
  const lines = body.split("\n");
  const argList = [quoteKosString(path), ...args.map(formatArg)].join(", ");
  // Body content as a single kerboscript string expression; CHAR(10)
  // between source lines, evaluated at the SET site once.
  const bodyExpr =
    lines.map((line) => quoteKosString(line)).join(" + CHAR(10) + ") || `""`;

  const out: string[] = [
    `// gonogo wrapper for ${quoteKosString(path)} v=${quoteKosString(version)}`,
    `SET gonogoWrapperTarget TO ${quoteKosString(path)}.`,
    `SET gonogoWrapperVerPath TO ${quoteKosString(verPath)}.`,
    `SET gonogoWrapperVersion TO ${quoteKosString(version)}.`,
    `SET gonogoWrapperBody TO ${bodyExpr}.`,
    `SET gonogoWrapperNeedsWrite TO TRUE.`,
    `IF EXISTS(gonogoWrapperTarget) AND EXISTS(gonogoWrapperVerPath) {`,
    `  IF OPEN(gonogoWrapperVerPath):READALL:STRING:TRIM = gonogoWrapperVersion {`,
    `    SET gonogoWrapperNeedsWrite TO FALSE.`,
    `  }`,
    `}`,
    `IF gonogoWrapperNeedsWrite {`,
    `  PRINT "wrapper: rewriting " + gonogoWrapperTarget + " v=" + gonogoWrapperVersion.`,
    `  IF EXISTS(gonogoWrapperTarget) { DELETEPATH(gonogoWrapperTarget). }`,
    `  IF EXISTS(gonogoWrapperVerPath) { DELETEPATH(gonogoWrapperVerPath). }`,
    `  LOG gonogoWrapperBody TO gonogoWrapperTarget.`,
    `  LOG gonogoWrapperVersion TO gonogoWrapperVerPath.`,
    `}`,
    `RUNPATH(${argList}).`,
  ];
  return `${out.join("\n")}\n`;
}

/**
 * Build the exact command text a single `executeScript` call dispatches over
 * the `kos.run` Uplink — the managed wrapper (via {@link buildKosWrapper})
 * when `managed` is supplied, or a bare `RUNPATH(...)` otherwise. Consumed
 * by the `kos.run` Uplink path (`kosUplinkExecutor.ts`) — the wrapper's
 * file-sync trick works because it's plain kerboscript, transport-agnostic.
 */
export function buildKosRunCommand(
  script: string,
  args: KosScriptArg[],
  managed: KosManagedScript | null,
): string {
  if (managed) {
    return buildKosWrapper({
      path: script,
      body: managed.body,
      version: managed.version,
      args,
    });
  }
  const argList = [JSON.stringify(script), ...args.map(formatBareArg)].join(
    ", ",
  );
  return `RUNPATH(${argList}).\n`;
}

/**
 * Arg formatter for the bare (unmanaged) `RUNPATH` form — kept distinct
 * from this file's sentinel-safe `formatArg` (used inside
 * {@link buildKosWrapper}'s wrapper body, which must also survive
 * `[KOSDATA]`-sentinel splitting). A bare RUNPATH argument list is never
 * echoed back through the parser as source, so simple `"`-doubling is
 * sufficient — this mirrors what `kosComputeSession.ts`'s `drain()` used
 * to build inline before this function was extracted.
 */
function formatBareArg(arg: KosScriptArg): string {
  if (typeof arg === "number") return String(arg);
  if (typeof arg === "boolean") return arg ? "true" : "false";
  return `"${arg.replace(/"/g, '""')}"`;
}

/**
 * Sentinels the kOS data-source parser keys off. The wrapper's source is
 * echoed verbatim by the kOS REPL on dispatch, so any contiguous
 * `[KOSDATA]...[/KOSDATA]` (or KOSERROR) byte sequence in the wrapper text
 * — even inside a string literal — gets matched by the parser BEFORE
 * the actual script runs. That captures the wrapper's source as the
 * widget's payload and the real script's [KOSDATA] never lands.
 *
 * Defeating it is purely a wire-bytes concern: `splitSentinels` breaks
 * each occurrence after the leading `[`, so the resulting pieces concat
 * to the same runtime string but no sentinel appears intact in the
 * source.
 *
 * The sentinels are written as prefixes (no trailing `]`) so they catch
 * both the bare `[KOSDATA]` form AND the topic-tagged `[KOSDATA:foo]`
 * form. Without that, scripts that emit `[KOSDATA:topic]...[/KOSDATA]`
 * leave the open marker intact in wrapper-echoed source; a later
 * `[/KOSDATA]` from the real script's PRINT then closes it and the lazy
 * parser regex captures the wrapper source as the payload.
 */
const PARSER_SENTINELS = ["[KOSDATA", "[/KOSDATA", "[KOSERROR", "[/KOSERROR"];

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
