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
 * Quote a JS string as a kOS string literal. kOS has no escape syntax —
 * the only way to embed a `"` is concatenation with `CHAR(34)`. Splits
 * on `"` and joins the fragments with `+ CHAR(34) +`.
 */
function quoteKosString(s: string): string {
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
