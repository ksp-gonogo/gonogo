// @vitest-environment node

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { transformSync } from "esbuild";
import { describe, expect, it } from "vitest";
import { PRIVATE_REFERENCE_DEBT } from "./private-references.debt";
import { PRIVATE_REFERENCE_PATTERNS } from "./private-references.patterns";
import {
  patternSeesFile,
  scanPrivateReferences,
} from "./private-references.scan";
import {
  baseCounts,
  ratchetBaseRef,
  sourceAtRatchetBase,
} from "./ratchetBaseRef";

/**
 * Private working references in tracked files: tracker numbers, agent and plan
 * labels, pointers at gitignored design notes, home-directory paths and private network addresses. They
 * mean nothing to a reader of the public tree and say something about the
 * machine and the process that wrote it.
 *
 * `private-references.patterns.ts` holds the definitions, one per kind, written
 * to match only the unambiguous spelling. `private-references.debt.ts` holds
 * what still matches, per file, and only ever shrinks.
 */

const DEBT_PATH = "packages/core/src/private-references.debt.ts";

const RESULT = scanPrivateReferences();

/** One line per kind that the pattern must see, built from pieces so this file is never a match. */
const PLANTED: Record<string, string> = {
  "tracker-name": `// ${"Sa"}${"ga"} 12 slice`,
  "ticket-number": `// ${"tick"}${"et"} 221 was filed`,
  "decision-number": `// (${"decis"}${"ion"} 5)`,
  "plan-label": `// the registry (${"Pl"}${"an"} 3)`,
  "agent-id": `// written by ${"ag"}${"ent"}-6`,
  "slice-label": `// ${"P1b"} ${"sl"}${"ice"} 2`,
  "private-doc": `// see ${"docs/super"}${"powers/plans/x.md"}`,
  "private-lan-address": `const host = "${"192.168"}.${"86.33"}";`,
  "home-path": `const p = "${"/Us"}${"ers/someone/x"}";`,
};

/** Spellings that look close and must stay unmatched. */
const NEGATIVES = [
  "// the column is 123 px wide",
  "// Plan the next step carefully",
  "// a ticket price of 4",
  "// a decision tree",
  "const user = '/usr/local/bin';",
  "const documented = '192.0.2.50';",
  "const dns = '8.8.8.8';",
  "const version = '10.2.3';",
  "const longer = '110.1.2.3';",
];

describe("private references", () => {
  it("actually scanned the tracked tree", () => {
    const hits = [...RESULT.counts.values()].reduce((a, b) => a + b, 0);
    const summary = `scanned ${RESULT.tracked} tracked files, ${RESULT.counts.size} carry a match, ${hits} matching lines`;
    console.info(`[private-references] ${summary}`);
    expect(RESULT.tracked, summary).toBeGreaterThan(5000);
  });

  it("can see every kind it claims to (planted)", () => {
    const dir = mkdtempSync(join(tmpdir(), "private-references-"));
    try {
      for (const [kind, pattern] of Object.entries(
        PRIVATE_REFERENCE_PATTERNS,
      )) {
        const planted = PLANTED[kind];
        expect(planted, `no planted line for ${kind}`).toBeDefined();
        const file = join(dir, `${kind}.txt`);
        writeFileSync(file, `${planted}\n`);
        expect(
          patternSeesFile(file, pattern),
          `the ${kind} pattern did not see its own planted line: the scan is blind to it`,
        ).toBe(true);
      }
      const negatives = join(dir, "negatives.txt");
      writeFileSync(negatives, `${NEGATIVES.join("\n")}\n`);
      for (const [kind, pattern] of Object.entries(
        PRIVATE_REFERENCE_PATTERNS,
      )) {
        expect(
          patternSeesFile(negatives, pattern),
          `the ${kind} pattern matched an ordinary line`,
        ).toBe(false);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("finds nothing outside the debt list", () => {
    const offenders: string[] = [];
    for (const [file, count] of RESULT.counts) {
      const allowed = PRIVATE_REFERENCE_DEBT[file] ?? 0;
      if (count > allowed) {
        offenders.push(`${file}: ${count} matching lines, ${allowed} allowed`);
      }
    }
    expect(
      offenders,
      [
        "Tracked files carry private working references (tracker numbers, plan or",
        "agent labels, pointers at gitignored notes, home paths). Reword the line",
        "so it stands on its own; do not add the file to the debt list.",
      ].join("\n"),
    ).toEqual([]);

    const slack: string[] = [];
    for (const [file, allowed] of Object.entries(PRIVATE_REFERENCE_DEBT)) {
      const count = RESULT.counts.get(file) ?? 0;
      if (count < allowed) slack.push(`${file}: ${allowed} -> ${count}`);
    }
    if (slack.length > 0) {
      console.info(`[private-references] lower: ${slack.join(", ")}`);
    }
  });

  describe("the debt list only ever shrinks", () => {
    function baseDebt(): Record<string, number> | undefined {
      const at = ratchetBaseRef();
      if (!at) return undefined;
      const source = sourceAtRatchetBase(at, DEBT_PATH);
      if (source === null) return undefined;
      const js = transformSync(source, { loader: "ts", format: "cjs" }).code;
      const module_ = { exports: {} as Record<string, unknown> };
      new Function("module", "exports", "require", js)(
        module_,
        module_.exports,
        createRequire(import.meta.url),
      );
      return baseCounts(module_.exports, "PRIVATE_REFERENCE_DEBT");
    }

    it("adds no file and raises no number", () => {
      const base = baseDebt();
      if (base === undefined) return;
      const grown: string[] = [];
      for (const [file, count] of Object.entries(PRIVATE_REFERENCE_DEBT)) {
        const before = base[file];
        if (before === undefined) {
          grown.push(`${file} (new entry: ${count})`);
          continue;
        }
        if (count > before) grown.push(`${file} (${before} -> ${count})`);
      }
      expect(grown, "the debt list only shrinks").toEqual([]);
    });
  });
});
