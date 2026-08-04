#!/usr/bin/env node
/**
 * Rewrites `{x}` to `<Unit value={x} />` where the compiler says `x` is a
 * `Value`.
 *
 * ## Why a codemod and not a lint rule
 *
 * Biome cannot see this. Its type inference lives only in built-in Rust rules,
 * and GritQL plugins match syntax without type information, so nothing in the
 * linter can tell `{altitude}` (a `Value<"m">`, which must not be rendered
 * bare) from `{label}` (a string, which must). `tsc` already knows: a plain
 * object is not a `ReactNode`, so it rejects the first and accepts the second.
 *
 * The warning therefore already exists and is already correct. What was
 * missing is the FIX, which is the same three-token edit every time and which
 * a migration produces hundreds of.
 *
 * ## How it works
 *
 * Run `tsc --noEmit` over a package, keep the TS2322/TS2746 diagnostics whose
 * message names `Value`, and rewrite the JSX expression container at each
 * reported position. Positions come from the compiler rather than from a
 * pattern, so a `{x}` the compiler is happy with is never touched.
 *
 * ## What it deliberately will not do
 *
 * - It skips anything that is not a lone identifier or property access
 *   (`{a.b.c}` is fine, `{f(x)}` and `{a ? b : c}` are not). A call's result
 *   may want unwrapping instead of rendering, and that is a judgement.
 * - It does not add the import. `<Unit>` comes from `@ksp-gonogo/ui-kit` and
 *   the file may already have a barrel import to extend, an aliased one, or
 *   none; guessing produces a merge conflict in the import block, which is
 *   the one edit nobody reads carefully.
 *
 * Both are reported so the remainder is a list rather than a surprise.
 *
 * Usage:
 *   node scripts/unit-codemod.mjs <package-dir> [--write]
 *
 * Without `--write` it prints what it would change and exits 0.
 */

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const [packageDir, ...flags] = process.argv.slice(2);
const write = flags.includes("--write");

if (!packageDir) {
  console.error("usage: node scripts/unit-codemod.mjs <package-dir> [--write]");
  process.exit(2);
}

/** `tsc` reports `file(line,col): error TSxxxx: message`. */
const DIAGNOSTIC = /^(.+?)\((\d+),(\d+)\): error (TS\d+): (.*)$/;

// The two the compiler raises for a Value in a ReactNode position: a plain
// assignment mismatch, and the "no overload matches" form JSX children take.
const RENDER_ERRORS = new Set(["TS2322", "TS2746", "TS2769"]);

// A lone identifier or property access, optionally optional-chained. Anything
// with a call, an operator or a conditional in it is left alone: see the
// header.
const SIMPLE = /^[A-Za-z_$][\w$]*(?:\??\.[A-Za-z_$][\w$]*)*$/;

function diagnostics(dir) {
  try {
    execFileSync(
      "npx",
      ["tsc", "--noEmit", "-p", resolve(dir, "tsconfig.json")],
      {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    return [];
  } catch (err) {
    return (
      String(err.stdout ?? "")
        .split("\n")
        .map((line) => line.match(DIAGNOSTIC))
        .filter(Boolean)
        .filter(([, , , , code, message]) => {
          return RENDER_ERRORS.has(code) && /\bValue\b/.test(message);
        })
        // tsc reports paths relative to the process's cwd, not to the project
        // it was pointed at.
        .map(([, file, line, col]) => ({
          file: resolve(process.cwd(), file),
          line: Number(line),
          col: Number(col),
        }))
    );
  }
}

/**
 * The JSX expression container the diagnostic sits inside, found by walking
 * out to the enclosing braces. The compiler points at the EXPRESSION, so the
 * open brace is to its left and the close brace balances it.
 */
function container(text, offset) {
  let open = offset;
  while (open > 0 && text[open] !== "{") open--;
  if (text[open] !== "{") return null;
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === "{") depth++;
    else if (text[i] === "}") {
      depth--;
      if (depth === 0) {
        return { open, close: i, inner: text.slice(open + 1, i).trim() };
      }
    }
  }
  return null;
}

function offsetOf(text, line, col) {
  let offset = 0;
  const lines = text.split("\n");
  for (let i = 0; i < line - 1; i++) offset += lines[i].length + 1;
  return offset + col - 1;
}

const byFile = new Map();
for (const d of diagnostics(packageDir)) {
  if (!byFile.has(d.file)) byFile.set(d.file, []);
  byFile.get(d.file).push(d);
}

let rewritten = 0;
const skipped = [];

for (const [file, sites] of byFile) {
  let text = readFileSync(file, "utf8");
  // Last first, so an earlier edit cannot move a later offset.
  const ordered = sites
    .map((s) => ({ ...s, offset: offsetOf(text, s.line, s.col) }))
    .sort((a, b) => b.offset - a.offset);

  for (const site of ordered) {
    const found = container(text, site.offset);
    if (found === null) {
      skipped.push(`${file}:${site.line} no JSX expression here`);
      continue;
    }
    // An attribute (`title={x}`) is not a render position: the value is going
    // into a string, and `speakQuantity` is the answer there, not `<Unit>`.
    const before = text.slice(0, found.open).trimEnd();
    if (before.endsWith("=")) {
      skipped.push(`${file}:${site.line} attribute, wants speakQuantity`);
      continue;
    }
    if (!SIMPLE.test(found.inner)) {
      skipped.push(`${file}:${site.line} not a plain read: ${found.inner}`);
      continue;
    }
    text =
      text.slice(0, found.open) +
      `<Unit value={${found.inner}} />` +
      text.slice(found.close + 1);
    rewritten++;
  }

  if (write) writeFileSync(file, text);
}

console.log(
  `${rewritten} rendered value(s) ${write ? "rewritten" : "to rewrite"}`,
);
if (skipped.length > 0) {
  console.log(`\n${skipped.length} left for a human:`);
  for (const s of skipped) console.log(`  ${s}`);
}
if (rewritten > 0 && write) {
  console.log(
    '\nImports are NOT added: import { Unit } from "@ksp-gonogo/ui-kit" ' +
      "in each file above, then re-run tsc.",
  );
}
