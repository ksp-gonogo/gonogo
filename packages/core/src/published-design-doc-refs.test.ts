// @vitest-environment node
//
// Node realm rather than the package's jsdom default, matching the other cross-package ratchets here: this one shells out to git.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  DESIGN_DOC_REF_DEBT,
  DESIGN_DOC_REF_PATTERNS,
  ORDINARY_COMPOUNDS,
  PUBLISHED_COMMENT_SURFACES,
} from "./published-design-doc-refs.allowlist";

/**
 * A comment that reaches a third-party author may not point at a document only
 * this repo has.
 *
 * `published-doc-reachability` is the gate for the neighbouring rule and is
 * BLIND to this one by construction, which is worth stating because 124
 * instances of this class stood while that gate's own debt sat at 21. It gates
 * SYMBOL reachability: a reference has to be in code form AND its head
 * identifier has to resolve to a declaration in this repo. `design §4.5` and
 * `local_docs/reports/video-worker-report.md` are neither, so all four of its
 * predicates that could fire never do:
 *
 * - `§4.5` fails the head-identifier match outright, so it produces no
 *   reference at all
 * - `design D-D` produces the head `design`, which resolves to no declaration,
 *   and that gate's predicate 3 puts a name resolving to nothing explicitly out
 *   of scope, because it is a STALE doc rather than an unreachable symbol
 * - a bare `packages/x/y.ts` or `@ksp-gonogo/x` is one of its own predicate-5
 *   QUALIFIER forms, so widening it to catch these would make it fire on the
 *   provenance it was built to permit
 * - it scans only `/** *\/` blocks, so a `//` file header is invisible to it
 *   even when the reference inside is a real symbol, which is how
 *   `control-channels.ts`'s pointer at an unpublished hook survived
 *
 * So this is a different instrument rather than a widening of that one, and it
 * asks a question that has no false-positive class: a design-document reference
 * is useless to an author 100% of the time. It cannot be looked up, and unlike a
 * file path it does not even say where a value came from. The fix is always to
 * rewrite the sentence so it stands without the pointer, never to qualify it.
 *
 * WHICH COMMENTS REACH AN AUTHOR differs per package, and the difference is
 * load-bearing rather than a detail:
 *
 * - `mod/sitrep-sdk` puts `src` in `files`, so EVERY comment in a non-test file
 *   lands in an author's `node_modules`, `//` headers included
 * - `packages/ui-kit` ships only `dist`, so only `/** *\/` blocks reach one, via
 *   tsup's `.d.ts` emit. Twelve `§` references were measured in its published
 *   `index.d.ts`, so this is not theoretical
 *
 * Scoping ui-kit to JSDoc is therefore not leniency, it is the actual boundary.
 * A `//` note in ui-kit is a note to us.
 */
const REPO_ROOT = join(import.meta.dirname, "..", "..", "..");

function gitFiles(dir: string): string[] {
  return execFileSync("git", ["ls-files", dir], {
    cwd: REPO_ROOT,
    encoding: "utf8",
  })
    .split("\n")
    .filter(Boolean);
}

function isTestFile(path: string): boolean {
  return /\.(test|test-d)\.tsx?$/.test(path);
}

/**
 * Every comment in `text`, or only its JSDoc blocks, one entry PER LINE.
 *
 * Split per line rather than per comment so a reported location is the line
 * carrying the reference. Reported per block, a header thirty lines long sends
 * the reader to its first line and they then have to find the pointer
 * themselves, which is a fix instruction that does not say where.
 */
function commentLines(text: string, jsdocOnly: boolean): [number, string][] {
  const found: [number, string][] = [];
  const lineOf = (index: number) => text.slice(0, index).split("\n").length;
  const push = (start: number, body: string) => {
    const first = lineOf(start);
    body.split("\n").forEach((line, offset) => {
      found.push([first + offset, line]);
    });
  };
  for (const m of text.matchAll(/\/\*[\s\S]*?\*\//g)) {
    if (jsdocOnly && !m[0].startsWith("/**")) continue;
    push(m.index, m[0]);
  }
  if (jsdocOnly) return found;
  for (const m of text.matchAll(/(^|\s)\/\/[^\n]*/g)) push(m.index, m[0]);
  return found;
}

function violations(): string[] {
  const patterns = DESIGN_DOC_REF_PATTERNS.map(
    ([source, flags]) =>
      new RegExp(source, flags.includes("g") ? flags : `${flags}g`),
  );
  const found: string[] = [];
  for (const surface of PUBLISHED_COMMENT_SURFACES) {
    for (const file of gitFiles(surface.dir)) {
      if (!/\.tsx?$/.test(file) || isTestFile(file)) continue;
      const text = readFileSync(join(REPO_ROOT, file), "utf8");
      for (const [line, body] of commentLines(text, surface.jsdocOnly)) {
        for (const pattern of patterns) {
          for (const hit of body.matchAll(pattern)) {
            if (ORDINARY_COMPOUNDS.includes(hit[0])) continue;
            found.push(`${file}:${line}: ${hit[0]}`);
          }
        }
      }
    }
  }
  return found.sort();
}

describe("design-document references on the published comment surface", () => {
  it("recognises the shapes it is looking for, so a green result means something", () => {
    const patterns = DESIGN_DOC_REF_PATTERNS.map(
      ([source, flags]) => new RegExp(source, flags),
    );
    const shouldMatch = [
      "see local_docs/reports/video-worker-report.md",
      "docs/superpowers/plans/2026-07-11-flight-lifecycle-spec.md",
      "the contribution-slots-spec.md ruling",
      "Uplink architecture spec §3.1",
      "PROPOSAL (design D-D)",
      "per the design doc §2.2",
    ];
    for (const sample of shouldMatch) {
      expect(
        patterns.some((p) => p.test(sample)),
        `no pattern matches: ${sample}`,
      ).toBe(true);
    }
    // And does not fire on what an author CAN read, or on ordinary prose.
    const shouldNotMatch = [
      "see docs/creating-an-uplink.md",
      "see docs/uplink-isolation.md",
      "the spec is what the contract says",
      "designed to fail loud",
    ];
    for (const sample of shouldNotMatch) {
      expect(
        patterns.find((p) => p.test(sample))?.source,
        `a pattern fires on: ${sample}`,
      ).toBeUndefined();
    }
    // The two ordinary compounds the filename pattern DOES match, and which the
    // scan drops afterwards. Asserted here so the exclusion cannot quietly widen.
    for (const sample of ORDINARY_COMPOUNDS) {
      expect(patterns.some((p) => p.test(sample))).toBe(true);
    }
  });

  it("scans a non-trivial number of files, so a broken file list cannot pass", () => {
    let scanned = 0;
    for (const surface of PUBLISHED_COMMENT_SURFACES) {
      scanned += gitFiles(surface.dir).filter(
        (f) => /\.tsx?$/.test(f) && !isTestFile(f),
      ).length;
    }
    expect(scanned).toBeGreaterThan(300);
  });

  it("points an author at no document they cannot read", () => {
    const unlisted = violations().filter(
      (v) => !DESIGN_DOC_REF_DEBT.includes(v.split(":").slice(0, 2).join(":")),
    );
    expect(
      unlisted,
      [
        "A comment that reaches a third-party author's install points at a",
        "document only this repo has.",
        "",
        "`local_docs/` and `docs/superpowers/` are gitignored, and a bare",
        "`§4.5` or `design D-D` names a section of one of them. An author reads",
        "a sentence that promises detail elsewhere and finds no elsewhere.",
        "",
        "Rewrite the sentence so it stands on its own. Do NOT qualify the",
        "reference: telling a reader which document they cannot read leaves them",
        "worse off than saying nothing, which is the same ruling",
        "published-doc-reachability's predicate 5 carries.",
        "",
        "DESIGN_DOC_REF_DEBT is shrink-only. A new entry means new code just",
        "created the violation.",
      ].join("\n"),
    ).toEqual([]);
  });
});
