// @vitest-environment node
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseColorTokens } from "@ksp-gonogo/theme";
import { afterAll, describe, expect, it } from "vitest";
import {
  type Finding,
  judgeTokenUses,
  scanTokenUses,
  type TokenScan,
} from "./test/tokenUse";

/**
 * The call-site half of the contrast gate: every colour token the kit draws,
 * measured against the ground it is drawn on.
 *
 * The theme's own table can only say which pairings are sound. A misuse is a
 * sound token on the wrong ground (the amber fill's dark text used as text on
 * a dark panel), so this reads the kit's source for what each styled rule,
 * SVG attribute and inline style actually paints, and on what. See
 * `test/tokenUse.ts` for how a token is traced and a ground is found.
 */
const SRC = fileURLToPath(new URL(".", import.meta.url));
const tokens = parseColorTokens(
  readFileSync(
    fileURLToPath(new URL("../../theme/src/tokens.css", import.meta.url)),
    "utf8",
  ),
);

/**
 * Real contrast findings that no token swap fixes, so the design itself has to
 * change. Each entry is `file site: token property on ground`.
 */
const AWAITING_RULING: Readonly<Record<string, string>> = {};

/**
 * Pairs the scan forms that the component never draws, each with what decides
 * the real ground and that the scan cannot see.
 */
const NOT_DRAWN_TOGETHER: Readonly<Record<string, string>> = {
  "Switch.tsx SwitchThumb: text-faint background on go-mark":
    "the thumb is faint only while unchecked, when the track is raised; the scan does not pair two components' $checked",
  "Tabs.tsx Tabs__Button: text-inverse color on surface-sunken":
    "the active label is drawn over Tabs__Blob, a sibling painted in accent-bg; a sibling's paint is not a ground the scan can see",
};

const judge = (scan: TokenScan) => judgeTokenUses(scan, tokens);

describe("colour tokens at their call sites", () => {
  const scan = scanTokenUses(SRC);
  const { findings, unknown } = judge(scan);
  const listed = new Set([
    ...Object.keys(AWAITING_RULING),
    ...Object.keys(NOT_DRAWN_TOGETHER),
  ]);

  it("traces every colour token to what it paints", () => {
    expect(scan.uses.length).toBeGreaterThan(300);
    expect(
      scan.unplaced.map((u) => `${u.file}:${u.line} ${u.token}: ${u.reason}`),
    ).toEqual([]);
  });

  it("names only tokens the theme declares", () => {
    expect(unknown).toEqual([]);
  });

  it("draws every token on grounds it clears", () => {
    expect(
      findings.filter((f) => !listed.has(f.key)).map((f) => f.detail),
    ).toEqual([]);
  });

  it("lists no exception that the scan no longer finds", () => {
    const found = new Set(findings.map((f) => f.key));
    expect([...listed].filter((k) => !found.has(k))).toEqual([]);
  });
});

describe("the call-site scan sees a misuse", () => {
  const root = mkdtempSync(join(tmpdir(), "token-call-sites-"));
  afterAll(() => rmSync(root, { recursive: true, force: true }));

  const plant = (name: string, source: string): Finding[] => {
    const dir = join(root, name);
    mkdirSync(dir);
    writeFileSync(join(dir, "Planted.tsx"), source);
    return judge(scanTokenUses(dir)).findings;
  };

  it("in a styled rule's text colour", () => {
    const found = plant(
      "text",
      [
        'import styled from "styled-components";',
        "export const Count = styled.span`",
        "  color: var(--color-warn-on-status);",
        "`;",
      ].join("\n"),
    );
    expect(found.map((f) => f.key)).toEqual([
      "Planted.tsx Count: warn-on-status color on surface-panel",
    ]);
  });

  it("in a mark whose colour comes from a helper", () => {
    const found = plant(
      "mark",
      [
        'import styled from "styled-components";',
        "function dotColor(tone: string) {",
        '  return tone === "go" ? "var(--color-go-status)" : "var(--color-accent-fg)";',
        "}",
        "const Dot = styled.span<{ $color: string }>`",
        `  background: \${({ $color }) => $color};`,
        "`;",
        'export const Go = () => <Dot $color={dotColor("go")} />;',
      ].join("\n"),
    );
    expect(found.map((f) => f.key)).toEqual([
      "Planted.tsx Dot: go-status background on surface-panel",
    ]);
  });

  it("in a text and ground read from two maps with one key, pairing only that key", () => {
    const found = plant(
      "keyed",
      [
        'import styled from "styled-components";',
        "const TEXT = {",
        '  go: "var(--color-go-text)",',
        '  warn: "var(--color-warn-on-status)",',
        "};",
        "const GROUND = {",
        '  go: "var(--color-go-muted)",',
        '  warn: "var(--color-warn-muted)",',
        "};",
        "export const Pill = styled.span<{ $tone: keyof typeof TEXT }>`",
        `  color: \${({ $tone }) => TEXT[$tone]};`,
        `  background: \${({ $tone }) => GROUND[$tone]};`,
        "`;",
      ].join("\n"),
    );
    expect(found.map((f) => f.key)).toEqual([
      "Planted.tsx Pill: warn-on-status color on warn-muted",
    ]);
  });

  it("in an SVG fill", () => {
    const found = plant(
      "svg",
      [
        "export const Zone = ({ color }: { color?: string }) => (",
        "  <svg>",
        '    <rect fill={color ?? "var(--color-warn-on-status)"} />',
        "  </svg>",
        ");",
      ].join("\n"),
    );
    expect(found.map((f) => f.key)).toEqual([
      "Planted.tsx <rect>: warn-on-status fill on surface-panel",
    ]);
  });
});
