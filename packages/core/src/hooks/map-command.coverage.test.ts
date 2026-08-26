import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Nothing dispatches a command through the retired action vocabulary.
 *
 * This gate used to ask a different question: every literal action string handed
 * to `dispatchActiveCommand(sourceId, action)` or to `execute(...)` had to be
 * either mapped by the write-half migration table or listed as a declared gap.
 * That table is gone, and with it the only thing that could have mapped one, so
 * the question it can still usefully ask is whether any such call site is left.
 *
 * The two forms it looks for are the two ways a caller could name a command
 * without naming it. `dispatchActiveCommand` took the widget-facing key and
 * resolved it through the table. `execute(...)` was the legacy `DataSource`
 * write path that a table miss fell back to. Neither can reach a command now,
 * so either one is a dispatch that silently does nothing.
 *
 * The floor is on the SCAN, not on the findings. A gate that required a
 * non-zero count of legacy call sites would fail on the success it exists to
 * produce, and one that counted them without a floor on what it walked would
 * pass on a scan that had gone blind: zero offenders is exactly what a broken
 * enumeration reports.
 */
const SCAN_ROOTS = ["components", "app"].map((pkg) =>
  join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", pkg, "src"),
);

function listSourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      out.push(...listSourceFiles(full));
      continue;
    }
    if (!/\.(tsx|ts)$/.test(entry)) continue;
    if (entry.includes(".test.")) continue;
    out.push(full);
  }
  return out;
}

/**
 * Comments across both packages record that these call sites are gone, so a
 * scan that read them would report every such note as an offender.
 */
function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

/**
 * A LITERAL action key handed to either form. Matching a literal rather than any
 * call is what the gate this replaces did, and it is the distinction that
 * matters: `PeerHostService` relays a station's `msg.action` to whatever
 * `DataSource` owns it, which names no command and asserts nothing about the
 * vocabulary. A literal in the source IS an assertion, by the author, that this
 * string reaches something.
 */
const RETIRED_DISPATCH_FORMS: readonly RegExp[] = [
  /\bdispatchActiveCommand\s*\([^,)]*,\s*["`]/,
  /\.execute\s*\(\s*["`]/,
];

const SCANNED = SCAN_ROOTS.flatMap(listSourceFiles);

describe("no command is dispatched through the retired action vocabulary", () => {
  it("walks the tree it claims to walk", () => {
    // A floor on the enumeration. Set well below the count at the time of
    // writing so adding or moving files never trips it.
    expect(SCANNED.length).toBeGreaterThan(200);
  });

  it("finds no call site naming a command it cannot reach", () => {
    const offenders = SCANNED.filter((file) => {
      const source = stripComments(readFileSync(file, "utf-8"));
      return RETIRED_DISPATCH_FORMS.some((re) => re.test(source));
    });

    expect(
      offenders,
      [
        "A command is dispatched through a form that can no longer reach one.",
        "",
        "`dispatchActiveCommand(sourceId, action)` resolved a widget-facing key",
        'through the write-half migration table, and `execute("...")` was the',
        "legacy DataSource write path a table miss fell back to. Both are gone,",
        "so either call dispatches nothing and says nothing.",
        "",
        "Name the command and its arguments directly, through `useCommand` in a",
        "component or `dispatchActiveCommandTopic` in a plain class.",
      ].join("\n"),
    ).toEqual([]);
  });
});
