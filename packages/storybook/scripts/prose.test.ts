import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { readExport } from "./ledger";
import {
  applyEdits,
  type ProseEdit,
  proseFingerprint,
  readCopy,
  readEdits,
  storiesShowing,
} from "./prose";
import { PROSE_SOURCES } from "./prose-sources";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

const MODULE = `/* A table. */
export const COPY = {
  "a.heading": "Welcome",
  "a.body":
    "Start the container. The [guide](deployment) covers its ports.",
  "b.count": "{count} {count?check|checks} need a look",
  plain: 'It said "hello"',
} as const;

export function unrelated() {
  return "Welcome";
}
`;

function texts(module: string): Record<string, string> {
  return Object.fromEntries(
    readCopy(module, "COPY").map((entry) => [entry.key, entry.text]),
  );
}

/** A sheet export as the page's Export JSON button writes it, carrying these edits. */
function sheetExport(edits: ProseEdit[]): unknown {
  return JSON.parse(
    JSON.stringify({
      generatedAt: "2026-10-05T00:00:00.000Z",
      sourceSha: "abc",
      items: edits.map((edit) => ({
        kind: "prose",
        id: edit.id,
        fingerprint: proseFingerprint(edit.old),
        approved: false,
        comments: [],
      })),
      prose: edits,
    }),
  );
}

describe("readCopy", () => {
  it("reads every string of the table, in order, and nothing outside it", () => {
    expect(texts(MODULE)).toEqual({
      "a.heading": "Welcome",
      "a.body":
        "Start the container. The [guide](deployment) covers its ports.",
      "b.count": "{count} {count?check|checks} need a look",
      plain: 'It said "hello"',
    });
  });

  it("refuses a table holding anything but plain string literals", () => {
    expect(() => readCopy("export const COPY = { a: 1 + 1 };", "COPY")).toThrow(
      /a is not a plain string literal/,
    );
    expect(() => readCopy(MODULE, "MISSING")).toThrow(/declares no MISSING/);
  });

  it("reads every registered source", () => {
    for (const source of PROSE_SOURCES) {
      const entries = readCopy(
        readFileSync(resolve(REPO, source.file), "utf8"),
        source.exportName,
        source.file,
      );
      expect(entries.length).toBeGreaterThan(0);
    }
  });
});

describe("an export applied to its table", () => {
  const edits: ProseEdit[] = [
    { id: "t:a.heading", old: "Welcome", new: "Start here" },
    {
      id: "t:a.body",
      old: "Start the container. The [guide](deployment) covers its ports.",
      new: 'Start it: see the [guide](deployment), "ports".',
    },
  ];

  it("round-trips: the table then reads the new text, and only those keys moved", () => {
    const read = readEdits(sheetExport(edits), "export.json");
    const result = applyEdits(MODULE, "COPY", "t", read);

    expect(result.refused).toEqual([]);
    expect(result.applied).toEqual(edits);
    expect(texts(result.text)).toEqual({
      ...texts(MODULE),
      "a.heading": "Start here",
      "a.body": 'Start it: see the [guide](deployment), "ports".',
    });
    expect(result.text).toContain('return "Welcome";');
    expect(result.text).toContain("/* A table. */");
  });

  it("gives an applied string a new fingerprint and leaves an untouched one its own", () => {
    const before = readCopy(MODULE, "COPY");
    const after = readCopy(applyEdits(MODULE, "COPY", "t", edits).text, "COPY");
    const print = (entries: typeof before, key: string) =>
      proseFingerprint(entries.find((e) => e.key === key)?.text ?? "");

    expect(print(after, "a.heading")).not.toBe(print(before, "a.heading"));
    expect(print(after, "b.count")).toBe(print(before, "b.count"));
  });

  it("refuses a key whose text moved on since the export, and still writes the rest", () => {
    const newer = applyEdits(MODULE, "COPY", "t", [
      { id: "t:a.heading", old: "Welcome", new: "A later rewrite" },
    ]).text;
    const result = applyEdits(newer, "COPY", "t", edits);

    expect(result.refused).toEqual([
      {
        id: "t:a.heading",
        why: 'the text has changed since the export: it now reads "A later rewrite"',
      },
    ]);
    expect(result.applied.map((e) => e.id)).toEqual(["t:a.body"]);
    expect(texts(result.text)["a.heading"]).toBe("A later rewrite");
  });

  it("reports an export applied twice as already there, not as stale", () => {
    const once = applyEdits(MODULE, "COPY", "t", edits).text;
    const twice = applyEdits(once, "COPY", "t", edits);

    expect(twice.already).toEqual(edits);
    expect(twice.refused).toEqual([]);
    expect(twice.text).toBe(once);
  });

  it("refuses a value or a link the old text did not have, and an empty text", () => {
    const result = applyEdits(MODULE, "COPY", "t", [
      { id: "t:a.heading", old: "Welcome", new: "Welcome, {name}" },
      {
        id: "t:a.body",
        old: "Start the container. The [guide](deployment) covers its ports.",
        new: "See [networking](networking).",
      },
      { id: "t:plain", old: 'It said "hello"', new: "  " },
      { id: "t:gone", old: "x", new: "y" },
    ]);

    expect(result.applied).toEqual([]);
    expect(result.text).toBe(MODULE);
    expect(result.refused.map((r) => r.why)).toEqual([
      "the new text asks for {name}, which nothing fills",
      "the new text links to (networking), which the old text did not",
      "the new text is empty",
      "COPY has no key gone",
    ]);
  });

  it("lets a rewrite drop a value and keep a plural", () => {
    const result = applyEdits(MODULE, "COPY", "t", [
      {
        id: "t:b.count",
        old: "{count} {count?check|checks} need a look",
        new: "{count?One check needs|Some checks need} a look",
      },
    ]);
    expect(result.refused).toEqual([]);
  });

  it("is an export the ledger also reads, prose items and all", () => {
    expect(readEdits({ items: [] }, "old.json")).toEqual([]);
    expect(() => readEdits({ items: [], prose: [{ id: "x" }] }, "f")).toThrow(
      /prose 0 is not/,
    );
    expect(() => readEdits({}, "f")).toThrow(/not a review-sheet export/);
  });
});

describe("storiesShowing", () => {
  const shown = {
    "t--welcome-idle": ["Step 1 of 6: Welcome", "Any Uplinks you have"],
    "t--uplinks-idle": [
      "Step 4 of 6: Uplinks",
      "2 Uplinks installed, 1 needs attention",
    ],
    "t--health-idle": ["Uplinks", "Copy run command", "v0.9.0"],
  };
  const order = Object.keys(shown);

  it("prefers the story named for the key's own step over one that only repeats the word", () => {
    expect(storiesShowing("uplinks.heading", "Uplinks", shown, order)).toEqual([
      "t--uplinks-idle",
    ]);
    expect(storiesShowing("health.row", "Uplinks", shown, order)).toEqual([
      "t--health-idle",
    ]);
  });

  it("matches a value as any text and a plural as either form", () => {
    expect(
      storiesShowing(
        "uplinks.check",
        "{n} {n?Uplink|Uplinks} installed, {a} {a?needs|need} attention",
        shown,
        order,
      ),
    ).toEqual(["t--uplinks-idle"]);
  });

  it("finds a label inside a longer attribute, and nothing for words no page has", () => {
    expect(storiesShowing("x.label", "run command", shown, order)).toEqual([
      "t--health-idle",
    ]);
    expect(storiesShowing("x.none", "no page says this", shown, order)).toEqual(
      [],
    );
  });
});

describe("the ledger's reading of an export", () => {
  it("accepts a prose item beside the story kinds", () => {
    const dir = mkdtempSync(join(tmpdir(), "prose-export-"));
    const file = join(dir, "export.json");
    writeFileSync(
      file,
      JSON.stringify(
        sheetExport([{ id: "t:a.heading", old: "Welcome", new: "Hi" }]),
      ),
    );
    try {
      expect(readExport(file).items).toEqual([
        {
          kind: "prose",
          id: "t:a.heading",
          approved: false,
          fingerprint: proseFingerprint("Welcome"),
        },
      ]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
