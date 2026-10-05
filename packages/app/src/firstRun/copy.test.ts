import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { type CopyKey, runs, runsOf, say, WIZARD_COPY } from "./copy";
import { SETUP_LINKS } from "./setupGuide";

const HERE = dirname(fileURLToPath(import.meta.url));
const KEYS = Object.keys(WIZARD_COPY) as CopyKey[];
/** Attributes whose value is read by an operator, on screen or by a screen reader. */
const WORDED_ATTRIBUTES = ["label", "aria-label", "title", "placeholder"];

/** Every non-test `.tsx` under the wizard's folder. */
function wizardSources(dir = HERE): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return wizardSources(full);
    return /\.tsx$/.test(entry.name) && !/\.test\.tsx$/.test(entry.name)
      ? [full]
      : [];
  });
}

/** Words a file spells in its own markup: JSX text, and a worded attribute given as a literal. */
function inlineWords(
  file: string,
  text = readFileSync(file, "utf8"),
): string[] {
  const source = ts.createSourceFile(
    file,
    text,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const found: string[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isJsxText(node) && /[A-Za-z]/.test(node.text)) {
      found.push(node.text.trim());
    }
    if (
      ts.isJsxAttribute(node) &&
      WORDED_ATTRIBUTES.includes(node.name.getText(source)) &&
      node.initializer &&
      ts.isStringLiteral(node.initializer)
    ) {
      found.push(node.initializer.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

describe("the wizard's copy table", () => {
  it("keys every string by step and field", () => {
    for (const key of KEYS) {
      expect(key).toMatch(
        /^(shell|welcome|container|connect|uplinks|health|done|settings)(\.[A-Za-z]+)+$/,
      );
    }
  });

  it("links only to pages setupGuide names", () => {
    for (const key of KEYS) {
      for (const match of WIZARD_COPY[key].matchAll(/\]\((\w+)\)/g)) {
        expect(Object.keys(SETUP_LINKS), key).toContain(match[1]);
      }
    }
  });

  it("is the only place the wizard spells a sentence", () => {
    const files = wizardSources();
    expect(files.length).toBeGreaterThan(6);
    expect(files.flatMap((file) => inlineWords(file))).toEqual([]);
  });

  it("sees a sentence spelled in markup, so a clean scan means something", () => {
    expect(
      inlineWords(
        "planted.tsx",
        'const a = <p title="Planted title">Planted words</p>;',
      ),
    ).toEqual(["Planted title", "Planted words"]);
  });
});

describe("a sentence's marks", () => {
  const words = (template: string, values?: Record<string, string | number>) =>
    runsOf(template, values)
      .map((run) => run.text)
      .join("");

  it("fills a value and picks the singular for one", () => {
    const template = "{n} {n?Uplink|Uplinks} installed, {a} {a?needs|need} it";
    expect(words(template, { n: 1, a: 1 })).toBe(
      "1 Uplink installed, 1 needs it",
    );
    expect(words(template, { n: 3, a: 2 })).toBe(
      "3 Uplinks installed, 2 need it",
    );
  });

  it("splits a sentence at its links, and fills inside one", () => {
    expect(
      runsOf("See the [{what} guide](docs) first.", { what: "CKAN" }),
    ).toEqual([
      { text: "See the " },
      { text: "CKAN guide", link: "docs" },
      { text: " first." },
    ]);
  });

  it("leaves bracketed words that are not a link, and a value nobody gave, alone", () => {
    expect(runsOf('Prints "[Gonogo] Started" at {where}')).toEqual([
      { text: 'Prints "[Gonogo] Started" at {where}' },
    ]);
  });
});

describe("say and runs", () => {
  it("read a key's sentence out of the table", () => {
    expect(say("welcome.heading")).toBe(WIZARD_COPY["welcome.heading"]);
    expect(
      runs("uplinks.install")
        .map((run) => run.text)
        .join(""),
    ).toBe(say("uplinks.install"));
  });

  it("will not compile a call that leaves out a value its string asks for", () => {
    // @ts-expect-error `connect.check.pass` asks for an address.
    expect(say("connect.check.pass")).toBe(WIZARD_COPY["connect.check.pass"]);
    // A value the string does not use is allowed, so a rewrite can drop one.
    expect(say("container.check.pass", { url: "x" })).toBe(
      WIZARD_COPY["container.check.pass"],
    );
  });
});
