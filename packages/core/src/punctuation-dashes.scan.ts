import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The scan behind `styleguide-punctuation-dashes.test.ts`.
 *
 * THE RULE, from CLAUDE.md: no em-dashes; use commas, colons, parentheses, or
 * separate sentences instead. The em dash is one character of a family, and
 * `styleguide-emdash.test.ts` gates that one character. Every other dash in the
 * family is the same defect wearing a different codepoint, and the en dash is
 * the one the tree actually writes.
 *
 * WHICH CHARACTERS, and why the set is derived rather than listed: a hand-picked
 * set only ever catches the spellings whoever picked it thought of. So the set
 * is Unicode's own `Dash_Punctuation` category, read off the regex engine at
 * load time, and a codepoint added to that category in a future Unicode release
 * is covered without anybody editing this file.
 *
 * TWO CHARACTERS ARE DELIBERATELY OUT, and both would be catastrophic in:
 *
 *   - BOX-DRAWING characters (U+2500 and its relatives) are a RULE, not
 *     punctuation. They draw banners, diagrams and shell output tens of
 *     thousands of times across the tree, and `banner-comments.matcher.ts` is
 *     built out of them. Unicode agrees: they are `So`, not `Pd`, so the
 *     derivation excludes them without needing a rule
 *   - U+2212 MINUS SIGN is a mathematical OPERATOR: orbital formulae, signed
 *     control ranges and rendered decrement buttons. It is `Sm`, so again the
 *     derivation excludes it, and this paragraph exists so nobody adds it back
 *     by hand
 *
 * The ASCII hyphen is excluded because it is the correct character, and the em
 * dash because `styleguide-emdash.test.ts` holds it to a STRICTER rule than this
 * one: zero outside a single sanctioned definition site, with no debt list at
 * all. Gating it in both places would let the two disagree about it.
 *
 * U+00AD SOFT HYPHEN is added to the derived set. It is `Cf` rather than `Pd`,
 * so no derivation reaches it, and it renders as nothing at all: it can only
 * ever arrive by paste and is invisible to the reader who would otherwise catch
 * it.
 *
 * This module never spells any of these characters literally, so it can never
 * appear in its own results. `String.fromCodePoint` rather than a `\u` escape,
 * because an escape survives a copy-paste or an editor round trip as the
 * character itself.
 */

/** Held to zero by `styleguide-emdash.test.ts`, which is stricter than this. */
const EM_DASH = String.fromCodePoint(0x2014);

/** The correct character, and the one everything here is a substitute for. */
const ASCII_HYPHEN = String.fromCodePoint(0x002d);

/** Invisible, `Cf` rather than `Pd`, and only ever a paste. */
const SOFT_HYPHEN = String.fromCodePoint(0x00ad);

/**
 * Unicode's `Dash_Punctuation` category, enumerated from the regex engine.
 *
 * The Basic Multilingual Plane plus the one plane above it that carries a dash
 * (U+10EAD), which is cheaper than walking all 17 planes to find one character.
 */
function dashPunctuation(): string[] {
  const isDash = /\p{Dash_Punctuation}/u;
  const found: string[] = [];
  for (let cp = 0; cp <= 0x10fff; cp++) {
    const ch = String.fromCodePoint(cp);
    if (isDash.test(ch)) found.push(ch);
  }
  return found;
}

/** Every dash this gate forbids, as single-character strings. */
export const FORBIDDEN_DASHES: readonly string[] = [
  ...dashPunctuation().filter(
    (ch) => ch !== ASCII_HYPHEN && ch !== EM_DASH && ch !== SOFT_HYPHEN,
  ),
  SOFT_HYPHEN,
];

/** `U+XXXX`, for a failure message that can be acted on without a hex dump. */
export function codepointName(ch: string): string {
  return `U+${(ch.codePointAt(0) ?? 0).toString(16).toUpperCase().padStart(4, "0")}`;
}

/**
 * Captured renders, not authored prose. A `.snap` file records whatever the
 * component drew, so a dash in one is a fact about already-gated source; the
 * fix belongs in the component, and rewriting the capture by hand would only be
 * undone by the next update. Same carve-out as `styleguide-emdash.test.ts`.
 */
const CAPTURED_RE = /\.snap$|\/__generated__\/|^__generated__\//;

/**
 * The one sanctioned dash: the published design system's interval separator,
 * `INTERVAL_DASH` in `Band.tsx`. It is a deliberate design choice rather than
 * debt, and recording it as debt would confuse whoever later tried to pay it
 * off. The same standing `NULL_DISPLAY` has in the em-dash gate, including the
 * assertion that the definition is still THERE, so the carve-out cannot outlive
 * its reason.
 */
export const SANCTIONED_FILE = "packages/ui-kit/src/Band.tsx";

/** How many the sanctioned file may contain: the definition, and nothing else. */
export const SANCTIONED_COUNT = 1;

export interface DashHit {
  /** 1-indexed line. */
  line: number;
  /** The codepoint, as `U+XXXX`. */
  codepoint: string;
  /** The trimmed line, for the failure message. */
  text: string;
}

export interface DashScan {
  /** Path to occurrence count. */
  counts: Map<string, number>;
  /** Path to the occurrences themselves. */
  hits: Map<string, DashHit[]>;
}

function repoRoot(): string {
  return execFileSync("git", ["rev-parse", "--show-toplevel"], {
    encoding: "utf8",
  }).trim();
}

/**
 * Files carrying at least one forbidden dash.
 *
 * `--untracked` is load-bearing: `git grep` alone searches only TRACKED files,
 * so a dash written into a brand new file is invisible until the moment it is
 * staged, and a local run before `git add` reports success while not looking at
 * it. It still honours `.gitignore`, so build output stays out. `-I` drops what
 * git considers binary, which is what keeps the visual baselines out.
 *
 * `--fixed-strings` with one `-e` per character rather than one bracket
 * expression: a bracket expression over multi-byte UTF-8 is not reliably a
 * character class in every git build, and a pattern that quietly matches
 * nothing is how this scan would report a clean tree.
 */
function filesWithDash(root: string): string[] {
  const args = ["grep", "--untracked", "-I", "-l", "--fixed-strings"];
  for (const ch of FORBIDDEN_DASHES) args.push("-e", ch);
  args.push("--", ".");
  let out: string;
  try {
    out = execFileSync("git", args, {
      cwd: root,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch (err) {
    // git grep exits 1 when nothing anywhere matches.
    const status =
      typeof err === "object" && err !== null
        ? Reflect.get(err, "status")
        : undefined;
    if (status === 1) return [];
    throw err;
  }
  return out
    .split("\n")
    .filter(Boolean)
    .filter((f) => !CAPTURED_RE.test(f));
}

/** Every forbidden dash in one file's source, in line order. */
export function dashesIn(source: string): DashHit[] {
  const found: DashHit[] = [];
  const lines = source.split("\n");
  for (const [i, raw] of lines.entries()) {
    for (const ch of FORBIDDEN_DASHES) {
      const n = raw.split(ch).length - 1;
      for (let k = 0; k < n; k++) {
        found.push({
          line: i + 1,
          codepoint: codepointName(ch),
          text: raw.trim(),
        });
      }
    }
  }
  return found;
}

/** Apply `dashesIn` to every file `git grep` says carries one. */
export function scanPunctuationDashes(): DashScan {
  const root = repoRoot();
  const counts = new Map<string, number>();
  const hits = new Map<string, DashHit[]>();
  for (const file of filesWithDash(root)) {
    let source: string;
    try {
      source = readFileSync(join(root, file), "utf8");
    } catch {
      continue;
    }
    const found = dashesIn(source);
    if (found.length > 0) {
      counts.set(file, found.length);
      hits.set(file, found);
    }
  }
  return { counts, hits };
}
