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
import { afterAll, describe, expect, it } from "vitest";
import { parseColorTokens } from "../../theme/src/contrast";
import {
  type Finding,
  judgeTokenUses,
  type ScanOptions,
  scanTokenUses,
} from "../../ui-kit/src/test/tokenUse";

/**
 * The call-site contrast gate over the app's widgets and chrome: every colour
 * token `components` and `ui` draw, measured against the ground it is drawn
 * on, including a token handed to a kit component's prop, which is followed
 * into the kit to the property it paints and judged at the call site that
 * handed it over. ui-kit's own call sites are gated by ui-kit's
 * `tokenCallSites.test.ts` with the same scan.
 */
const PACKAGES = fileURLToPath(new URL("../../../packages/", import.meta.url));
const src = (pkg: string) => join(PACKAGES, pkg, "src");
const tokens = parseColorTokens(
  readFileSync(join(PACKAGES, "theme", "src", "tokens.css"), "utf8"),
);

const KIT = { "@ksp-gonogo/ui-kit": src("ui-kit") };
const SCANNED: Readonly<Record<string, ScanOptions>> = {
  components: { libraries: { ...KIT, "@ksp-gonogo/ui": src("ui") } },
  ui: { libraries: KIT },
};

/**
 * Real contrast findings that no token swap fixes, so the design itself has to
 * change. Each entry is `package/file site: token property on ground`.
 */
const AWAITING_RULING: Readonly<Record<string, string>> = {
  "components/Graph/GraphView.tsx <LineChart series>: go-mark fill on surface-panel":
    "the circular-orbit reference curve is green as a mark, and LineChart also draws a series colour as its label's text, 4.07:1 where text needs 4.5:1",
};

/**
 * Pairs the scan forms that the component never draws, each with what decides
 * the real ground and that the scan cannot see.
 */
const NOT_DRAWN_TOGETHER: Readonly<Record<string, string>> = {
  "components/TechTree/styles.ts StateBadge: text-faint color on go-status":
    "the badge is faint only for its muted tone, which paints no fill; the scan does not pair two helpers keyed on the same $tone",
};

/** Token literals the scan cannot follow to what paints them, each with why. */
const UNTRACED: Readonly<Record<string, string>> = {
  "components/LandingStatus/descentLayers.ts info-mark":
    "the haze tint travels in a plot layer the widget contributes through a registry, not a component it renders",
};

function judgeAll() {
  const findings: Finding[] = [];
  const unknown: string[] = [];
  const unplaced: string[] = [];
  let uses = 0;
  for (const [pkg, options] of Object.entries(SCANNED)) {
    const scan = scanTokenUses(src(pkg), options);
    uses += scan.uses.length;
    const judged = judgeTokenUses(scan, tokens);
    findings.push(
      ...judged.findings.map((f) => ({ ...f, key: `${pkg}/${f.key}` })),
    );
    unknown.push(...judged.unknown.map((u) => `${pkg}/${u}`));
    unplaced.push(
      ...scan.unplaced.map((u) => `${pkg}/${u.file}:${u.line} ${u.token}`),
    );
  }
  return { findings, unknown, unplaced, uses };
}

describe("colour tokens at their call sites in components and ui", () => {
  const { findings, unknown, unplaced, uses } = judgeAll();
  const listed = new Set([
    ...Object.keys(AWAITING_RULING),
    ...Object.keys(NOT_DRAWN_TOGETHER),
  ]);
  const untraced = (u: string) => u.replace(/:\d+ /, " ");

  it("traces every colour token to what it paints", () => {
    expect(uses).toBeGreaterThan(1400);
    expect(unplaced.filter((u) => !UNTRACED[untraced(u)])).toEqual([]);
  });

  it("lists no untraced token the scan now follows", () => {
    const still = new Set(unplaced.map(untraced));
    expect(Object.keys(UNTRACED).filter((k) => !still.has(k))).toEqual([]);
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

describe("the call-site scan sees a misuse in a widget", () => {
  const root = mkdtempSync(join(tmpdir(), "contrast-call-sites-"));
  afterAll(() => rmSync(root, { recursive: true, force: true }));

  const plant = (name: string, source: string): string[] => {
    const dir = join(root, name);
    mkdirSync(dir);
    writeFileSync(join(dir, "Planted.tsx"), source);
    return judgeTokenUses(scanTokenUses(dir, SCANNED.components), tokens)
      .findings.map((f) => f.key)
      .sort();
  };

  it("in a colour handed to a kit component's prop", () => {
    expect(
      plant(
        "prop",
        [
          'import { Meter } from "@ksp-gonogo/ui-kit";',
          "export const Fuel = () => (",
          '  <Meter label="LF" value={1} capacity={2} fillColor="var(--color-go-status)" />',
          ");",
        ].join("\n"),
      ),
    ).toEqual([
      "Planted.tsx <Meter fillColor>: go-status background on surface-raised",
    ]);
  });

  it("in a style object held in a constant", () => {
    expect(
      plant(
        "style",
        [
          'import type { CSSProperties } from "react";',
          "const LABEL: CSSProperties = {",
          '  color: "var(--color-warn-on-status)",',
          "};",
          "export const Label = () => <span style={LABEL}>NET</span>;",
        ].join("\n"),
      ),
    ).toEqual([
      "Planted.tsx <span> style: warn-on-status color on surface-panel",
    ]);
  });

  it("in a tone map read through the widget's own component", () => {
    expect(
      plant(
        "tone",
        [
          "const TONE = {",
          '  go: "var(--color-go-status)",',
          '  nogo: "var(--color-nogo-text)",',
          "} as const;",
          "function Dot({ colour }: { colour: string }) {",
          "  return <svg><circle r={4} fill={colour} /></svg>;",
          "}",
          'export const Link = ({ tone }: { tone: "go" | "nogo" }) => (',
          "  <Dot colour={TONE[tone]} />",
          ");",
        ].join("\n"),
      ),
    ).toEqual(["Planted.tsx <circle>: go-status fill on surface-panel"]);
  });
});
