#!/usr/bin/env node
/*
 * Emdash audit: enumerate every U+2014 (EM DASH) occurrence in
 * git-tracked files and bucket each hit so a sweep (this one or a future
 * one) can be reviewed and migrated systematically instead of ad hoc.
 *
 * This file is a tool for hunting the character down, so it deliberately
 * never spells the character literally: every reference below uses the
 * escape sequence backslash-u-2014 instead, both in code and in these
 * comments. That keeps this script itself out of its own results, and
 * off the ratchet's radar (see packages/core/src/styleguide-emdash.test.ts).
 *
 * Buckets:
 *   - "null-placeholder": the sanctioned UI convention, a rendered value
 *     standing in for "no data yet" (a bare quoted em dash string, a JSX
 *     text node sitting directly between two tags, or a JSX expression whose
 *     quoted content, once trimmed, is exactly one em dash and nothing
 *     else). This is the ONE meaning allowed to survive; after migration
 *     these call sites should route through `@ksp-gonogo/ui-kit`'s
 *     null-display token instead of a raw literal.
 *   - "prose-comment-doc": narration in `//`/`/*`/`*`/`///` comments,
 *     JSDoc, markdown prose, docstrings. Fix by rewriting with ordinary
 *     punctuation (comma, colon, semicolon, or a sentence break).
 *   - "string-literal-user-visible": a quoted string, JSX text, or
 *     template literal shown to a user that contains an em dash as part
 *     of a longer message (not a bare null placeholder). Fix the same
 *     way as prose, but flag as a rendered-string change for review.
 *   - "other": anything the above heuristics don't confidently place
 *     (rare; read manually).
 *
 * Usage:
 *   node scripts/emdash-audit.mjs [--json out.json] [--exclude <path>]... [<scan-path>...]
 *
 * With no positional args, scans every git-tracked file in the repo
 * (always skipping `__generated__/` trees). Pass one or more scan-paths
 * (file or directory prefixes, relative to repo root) to scope the scan,
 * e.g. to audit a single directory another sweep owns:
 *
 *   node scripts/emdash-audit.mjs packages/components/src/CrewManifest
 *
 * Pass --exclude to additionally prune path prefixes from a repo-wide
 * scan (used here to skip directories a concurrent sweep owns).
 *
 * Prints a per-bucket summary to stdout; --json writes the full
 * per-occurrence report (file, line, column, bucket, text) for tooling.
 */

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const EMDASH = "\u2014";

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const scanPaths = [];
  const excludes = [];
  let jsonOut = null;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--json") {
      jsonOut = argv[++i];
    } else if (a === "--exclude") {
      excludes.push(argv[++i]);
    } else if (a.startsWith("-")) {
      throw new Error(`Unknown flag: ${a}`);
    } else {
      scanPaths.push(a);
    }
  }
  return { scanPaths, excludes, jsonOut };
}

// ---------------------------------------------------------------------------
// File discovery: git-tracked, contains an emdash, not generated
// ---------------------------------------------------------------------------

function gitTrackedFilesContainingEmdash() {
  // -I: skip files git considers binary. -l: filenames only.
  // The `--` protects against a leading "-" in the pattern being read as
  // a flag; the pattern itself is passed as raw bytes for U+2014.
  let out;
  try {
    out = execFileSync("git", ["grep", "-Il", EMDASH, "--", "."], {
      cwd: ROOT,
      encoding: "utf8",
      maxBuffer: 1024 * 1024 * 64,
    });
  } catch (err) {
    // git grep exits 1 when there are no matches at all.
    if (err.status === 1) return [];
    throw err;
  }
  return out.split("\n").filter(Boolean);
}

function isExcluded(relPath, excludes) {
  if (
    relPath.includes("/__generated__/") ||
    relPath.startsWith("__generated__/")
  )
    return true;
  if (relPath.includes("/node_modules/") || relPath.startsWith("node_modules/"))
    return true;
  return excludes.some(
    (ex) => relPath === ex || relPath.startsWith(`${ex.replace(/\/$/, "")}/`),
  );
}

function isInScope(relPath, scanPaths) {
  if (scanPaths.length === 0) return true;
  return scanPaths.some(
    (p) => relPath === p || relPath.startsWith(`${p.replace(/\/$/, "")}/`),
  );
}

// ---------------------------------------------------------------------------
// Per-line classification
// ---------------------------------------------------------------------------

const LINE_COMMENT_PREFIXES = ["//", "///", "*", "/*", "#"];

// Extensions where a `/* ... */` block comment can legitimately span
// multiple lines, and ones where `<!-- ... -->` can. Used to carry
// "currently inside a block comment" state across lines in a file so a
// continuation line (one with no `//`/`*` prefix of its own) is still
// classified as prose, not misread as code or a stray string literal.
const SLASH_STAR_EXTS = new Set([
  "ts",
  "tsx",
  "js",
  "jsx",
  "mjs",
  "cjs",
  "cs",
  "css",
]);
const XML_COMMENT_EXTS = new Set(["html", "htm", "xml", "csproj", "svg"]);

function isCommentLine(trimmed, ext) {
  if (ext === "md" || ext === "txt") return true; // whole file is prose
  return LINE_COMMENT_PREFIXES.some((p) => trimmed.startsWith(p));
}

// Matches a quoted (or backtick) span; used to find the smallest quoted
// region containing a given emdash index.
const QUOTE_SPAN_RE = /"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`/g;

// Bare JSX text-node placeholder: an em dash sitting directly between
// two tags, e.g. a <span> whose only child is the character, tolerating
// whitespace. A ternary like `ready ? x : "<em dash>"` is caught by the
// quote check below instead.
const JSX_BARE_PLACEHOLDER_RE = />\s*\u2014\s*</;

// HTML/JSX text content that isn't a bare placeholder, e.g. an em dash
// inside a <title>'s text. Rendered to a user, so it's the same bucket
// as a user-visible string literal even though there's no quote mark
// involved.
const TAG_TEXT_RE = />([^<>]*\u2014[^<>]*)</;

// Line-comment markers, keyed by extension, used to find a *trailing*
// `// ...` (or `# ...`) comment after real code on the same line, e.g.
// a statement followed by a trailing comment containing an em dash.
const SLASH_SLASH_EXTS = new Set([
  "ts",
  "tsx",
  "js",
  "jsx",
  "mjs",
  "cjs",
  "cs",
  "css",
]);
const HASH_EXTS = new Set(["sh", "py", "yml", "yaml"]);

/** Blank out the contents of quoted spans (keeping length/position) so a
 * comment-marker search doesn't trip on a `//` or `#` inside a string. */
function stripQuotedSpans(line) {
  return line.replace(QUOTE_SPAN_RE, (m) => " ".repeat(m.length));
}

/** Index of a trailing line-comment marker outside any quoted span, or -1. */
function trailingCommentIndex(line, ext) {
  const stripped = stripQuotedSpans(line);
  if (SLASH_SLASH_EXTS.has(ext)) {
    const idx = stripped.indexOf("//");
    if (idx !== -1) return idx;
  }
  if (HASH_EXTS.has(ext)) {
    const idx = stripped.indexOf("#");
    if (idx !== -1) return idx;
  }
  return -1;
}

/**
 * Classify one line. `state` is mutated in place to carry block-comment
 * status to the next call for the same file (see SLASH_STAR_EXTS /
 * XML_COMMENT_EXTS above).
 */
function classifyLine(line, ext, state) {
  const trimmed = line.trim();

  if (state.inBlockComment) {
    const closer = state.blockCloser;
    const closeIdx = line.indexOf(closer);
    if (closeIdx !== -1) {
      state.inBlockComment = false;
      state.blockCloser = null;
      // Anything after the closer on this line is ordinary code/text;
      // only re-classify if there's more content there.
      const rest = line.slice(closeIdx + closer.length);
      if (rest.includes(EMDASH)) return classifyLine(rest, ext, state);
    }
    return "prose-comment-doc";
  }

  if (isCommentLine(trimmed, ext)) {
    maybeOpenBlockComment(trimmed, ext, state);
    return "prose-comment-doc";
  }

  // A block comment can also start mid-line after real code, e.g.
  // a statement followed by a `/* trailing note ... */`. Detect an
  // unclosed opener.
  if (maybeOpenBlockComment(line, ext, state, { requireEmdashAfter: true })) {
    return "prose-comment-doc";
  }

  // A trailing `// ...` (or `# ...`) comment after real code, e.g.
  // a statement followed by a trailing `//` comment.
  // Only counts if the emdash is actually inside the comment tail, not
  // in the code portion before the marker.
  const commentIdx = trailingCommentIndex(line, ext);
  if (commentIdx !== -1) {
    const codePart = line.slice(0, commentIdx);
    if (!codePart.includes(EMDASH)) return "prose-comment-doc";
  }

  // Does an emdash fall inside a quoted/template span on this line?
  QUOTE_SPAN_RE.lastIndex = 0;
  for (const quoteMatch of line.matchAll(QUOTE_SPAN_RE)) {
    const span = quoteMatch[0];
    if (span.includes(EMDASH)) {
      const inner = span.slice(1, -1).trim();
      if (inner === EMDASH) return "null-placeholder";
      return "string-literal-user-visible";
    }
  }

  if (JSX_BARE_PLACEHOLDER_RE.test(line)) return "null-placeholder";
  if (TAG_TEXT_RE.test(line)) return "string-literal-user-visible";

  return "other";
}

/**
 * If `text` opens a block comment (`/*` or `<!--`) that isn't closed on
 * the same line, flip `state.inBlockComment` on for subsequent lines.
 * Returns true when it detected an (opened-and-unclosed) block comment
 * opener at all; used by the mid-line case to decide the bucket for the
 * opener line itself.
 */
function maybeOpenBlockComment(text, ext, state, opts = {}) {
  let opener = null;
  let closer = null;
  if (SLASH_STAR_EXTS.has(ext) && text.includes("/*")) {
    opener = "/*";
    closer = "*/";
  } else if (XML_COMMENT_EXTS.has(ext) && text.includes("<!--")) {
    opener = "<!--";
    closer = "-->";
  }
  if (!opener) return false;

  const openIdx = text.indexOf(opener);
  if (opts.requireEmdashAfter && !text.slice(openIdx).includes(EMDASH)) {
    return false;
  }
  const closeIdx = text.indexOf(closer, openIdx + opener.length);
  if (closeIdx === -1) {
    state.inBlockComment = true;
    state.blockCloser = closer;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Scan
// ---------------------------------------------------------------------------

function extOf(relPath) {
  const m = /\.([a-zA-Z0-9]+)$/.exec(relPath);
  return m ? m[1].toLowerCase() : "";
}

function scan({ scanPaths, excludes }) {
  const files = gitTrackedFilesContainingEmdash();
  const occurrences = [];
  const byFile = new Map();

  for (const relPath of files) {
    if (isExcluded(relPath, excludes)) continue;
    if (!isInScope(relPath, scanPaths)) continue;

    // Read from the working tree, not `git show HEAD:`, so uncommitted
    // edits mid-sweep are reflected; `gitTrackedFilesContainingEmdash`
    // above already used `git grep` (also working-tree-based), so this
    // keeps discovery and content in sync.
    const text = readFileSync(join(ROOT, relPath), "utf8");

    const ext = extOf(relPath);
    const lines = text.split("\n");
    let fileCount = 0;
    const state = { inBlockComment: false, blockCloser: null };
    lines.forEach((line, i) => {
      const count = line.split(EMDASH).length - 1;
      if (count === 0) {
        // Still need to track block-comment state even on emdash-free
        // lines, so a later line's classification is correct.
        if (state.inBlockComment) {
          const closeIdx = line.indexOf(state.blockCloser);
          if (closeIdx !== -1) {
            state.inBlockComment = false;
            state.blockCloser = null;
          }
        } else {
          maybeOpenBlockComment(line, ext, state);
        }
        return;
      }
      const bucket = classifyLine(line, ext, state);
      for (let k = 0; k < count; k++) {
        occurrences.push({
          file: relPath,
          line: i + 1,
          bucket,
          text: line.trim().slice(0, 200),
        });
      }
      fileCount += count;
    });
    if (fileCount > 0) byFile.set(relPath, fileCount);
  }

  return { occurrences, byFile };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  const { scanPaths, excludes, jsonOut } = parseArgs(process.argv.slice(2));
  const { occurrences, byFile } = scan({ scanPaths, excludes });

  const buckets = new Map();
  for (const o of occurrences) {
    buckets.set(o.bucket, (buckets.get(o.bucket) ?? 0) + 1);
  }

  console.log(`Scanned ${byFile.size} file(s) with an emdash.`);
  console.log(`Total occurrences: ${occurrences.length}\n`);
  console.log("By bucket:");
  for (const [bucket, count] of [...buckets.entries()].sort(
    (a, b) => b[1] - a[1],
  )) {
    console.log(`  ${bucket.padEnd(28)} ${count}`);
  }

  if (buckets.get("other")) {
    console.log('\n"other" sample (read these manually):');
    occurrences
      .filter((o) => o.bucket === "other")
      .slice(0, 20)
      .forEach((o) => {
        console.log(`  ${o.file}:${o.line}  ${o.text}`);
      });
  }

  if (jsonOut) {
    const outPath = isAbsolute(jsonOut) ? jsonOut : join(ROOT, jsonOut);
    writeFileSync(
      outPath,
      JSON.stringify(
        {
          scannedAt: new Date().toISOString(),
          scanPaths,
          excludes,
          totalFiles: byFile.size,
          totalOccurrences: occurrences.length,
          byBucket: Object.fromEntries(buckets),
          occurrences,
        },
        null,
        2,
      ),
    );
    console.log(
      `\nWrote ${isAbsolute(jsonOut) ? outPath : relative(ROOT, outPath)}`,
    );
  }
}

main();
