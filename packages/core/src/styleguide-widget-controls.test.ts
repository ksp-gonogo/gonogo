import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";

/**
 * Design-system guard: a widget draws a control with the kit's control
 * primitives (the `Button` family, `IconButton`, `Input`, `Select`, `Slider`,
 * `FieldLabel`, the interactive `Row`), never by turning a layout primitive
 * into one or by restyling a raw control inline. A hand-rolled control gets
 * none of the kit's colour, focus ring or states, and inherits whatever the
 * browser gives a bare control, which is how a button's words came out black
 * on a dark panel.
 *
 * Two shapes fail: an `as` naming a control element on a component other than
 * the kit's `Row`, which is built to be one; and a raw control element
 * carrying a `style`.
 */

const CONTROL_ELEMENTS = new Set([
  "button",
  "a",
  "input",
  "select",
  "textarea",
  "label",
  "summary",
  "option",
]);

/** Kit components built to render as a control. */
const CONTROL_CAPABLE = new Set(["Row"]);

/** Far under the ~240 widget files the walk reaches, so only a broken enumeration trips it. */
const MINIMUM_FILES_SCANNED = 150;

function findRepoRoot(start: string): string {
  let dir = start;
  while (dir !== "/") {
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) return dir;
    dir = dirname(dir);
  }
  throw new Error(`Could not locate workspace root from ${start}`);
}

function isWidgetFile(rel: string): boolean {
  if (!/\.tsx$/.test(rel) || /\.test\.tsx$|\.stories\.tsx$/.test(rel)) {
    return false;
  }
  if (rel.startsWith("packages/components/src/")) return true;
  return rel.startsWith("mod/") && rel.includes("/client/src/");
}

function widgetFiles(root: string): string[] {
  return execFileSync(
    "git",
    ["ls-files", "-z", "--", "packages/components/src", "mod"],
    { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  )
    .split("\0")
    .filter(isWidgetFile);
}

/** Every hand-rolled control in one source file, as `file:line <tag ...>`. */
function handRolledControls(file: string, source: string): string[] {
  const sf = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const found: string[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const tag = node.tagName.getText(sf);
      const attrs = node.attributes.properties.filter(ts.isJsxAttribute);
      const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
      const as = attrs.find((a) => a.name.getText(sf) === "as");
      const asValue =
        as?.initializer && ts.isStringLiteral(as.initializer)
          ? as.initializer.text
          : null;
      if (
        asValue !== null &&
        CONTROL_ELEMENTS.has(asValue) &&
        !CONTROL_CAPABLE.has(tag)
      ) {
        found.push(`${file}:${line} <${tag} as="${asValue}">`);
      }
      if (
        CONTROL_ELEMENTS.has(tag) &&
        attrs.some((a) => a.name.getText(sf) === "style")
      ) {
        found.push(`${file}:${line} <${tag} style>`);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return found;
}

describe("design-system: widgets draw controls with the kit's control primitives", () => {
  const root = findRepoRoot(dirname(fileURLToPath(import.meta.url)));
  const files = widgetFiles(root);

  it("is actually looking at the widgets", () => {
    expect(files.length).toBeGreaterThanOrEqual(MINIMUM_FILES_SCANNED);
  });

  it("finds no hand-rolled control", { timeout: 120_000 }, () => {
    const found = files.flatMap((rel) =>
      handRolledControls(rel, readFileSync(join(root, rel), "utf8")),
    );
    expect(found).toEqual([]);
  });

  it("sees each shape it bans, and lets the kit's own controls through (planted)", () => {
    const planted = [
      "export const A = () => (",
      "  <>",
      '    <Stack as="button" onClick={go}>Chutes</Stack>',
      '    <Box as="a" href="#">link</Box>',
      '    <button type="button" style={{ background: "none", border: "none" }}>x</button>',
      '    <input type="range" style={{ flex: 1 }} />',
      '    <Row as="button" interactive>row</Row>',
      '    <Button variant="text" style={{ flex: 1 }}>name</Button>',
      '    <Stack as="ul"><li>item</li></Stack>',
      "  </>",
      ");",
    ].join("\n");
    expect(handRolledControls("Planted.tsx", planted)).toEqual([
      'Planted.tsx:3 <Stack as="button">',
      'Planted.tsx:4 <Box as="a">',
      "Planted.tsx:5 <button style>",
      "Planted.tsx:6 <input style>",
    ]);
  });
});
