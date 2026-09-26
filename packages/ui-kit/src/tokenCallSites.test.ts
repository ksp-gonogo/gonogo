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
import {
  CONTRAST_FLOOR,
  contrastRatio,
  DECORATIVE,
  EXEMPT,
  parseColorTokens,
} from "@ksp-gonogo/theme";
import { afterAll, describe, expect, it } from "vitest";
import { scanTokenUses, type TokenScan } from "./test/tokenUse";

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
 * Findings that are real and wait on a design ruling rather than a token
 * swap. Each entry is `file site: token property on ground`.
 */
const AWAITING_RULING: Readonly<Record<string, string>> = {
  "DataKeyPicker.tsx PickerInput &::placeholder: text-faint color on surface-raised":
    "placeholder text in the faint tier on the raised input, 4.05:1; faint is the placeholder tier and fails on raised",
};

/**
 * Pairs the scan forms that the component never draws, each with what decides
 * the real ground and that the scan cannot see.
 */
const NOT_DRAWN_TOGETHER: Readonly<Record<string, string>> = {
  "Switch.tsx SwitchThumb: text-faint background on status-go-mark":
    "the thumb is faint only while unchecked, when the track is raised; the scan does not pair two components' $checked",
  "Tabs.tsx Tabs__Button: text-inverse color on surface-sunken":
    "the active label is drawn over Tabs__Blob, a sibling painted in accent-bg; a sibling's paint is not a ground the scan can see",
};

interface Finding {
  readonly key: string;
  readonly detail: string;
}

function judge(scan: TokenScan): { findings: Finding[]; unknown: string[] } {
  const findings = new Map<string, Finding>();
  const unknown: string[] = [];
  for (const u of scan.uses) {
    if (!tokens.has(u.token) && !u.token.startsWith("marker-")) {
      unknown.push(`${u.file}:${u.line} ${u.token}`);
      continue;
    }
    if (u.role === "ground" || EXEMPT[u.token]) continue;
    if (DECORATIVE.includes(u.token) && u.role !== "text") continue;
    const fg = tokens.get(u.token) as string;
    for (const ground of u.grounds) {
      const bg = tokens.get(ground);
      if (!bg) {
        unknown.push(`${u.file}:${u.line} ground ${ground}`);
        continue;
      }
      const ratio = contrastRatio(fg, bg);
      const floor = CONTRAST_FLOOR[u.role];
      const fillCarries = u.beside.some((f) => {
        const hex = tokens.get(f);
        return (
          hex !== undefined &&
          contrastRatio(hex, bg) >= CONTRAST_FLOOR["non-text"]
        );
      });
      if (ratio >= floor || fillCarries) continue;
      const key = `${u.file} ${u.site}: ${u.token} ${u.property} on ${ground}`;
      const at = `${u.file}:${u.line}`;
      const prior = findings.get(key);
      findings.set(key, {
        key,
        detail: prior
          ? `${prior.detail}, ${at}`
          : `${u.site}: ${u.token} as ${u.role} (${u.property}) on ${ground}, ${ratio.toFixed(2)}:1 where ${floor}:1 is needed, at ${at}`,
      });
    }
  }
  return { findings: [...findings.values()], unknown };
}

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
        "  color: var(--color-status-warning-fg);",
        "`;",
      ].join("\n"),
    );
    expect(found.map((f) => f.key)).toEqual([
      "Planted.tsx Count: status-warning-fg color on surface-panel",
    ]);
  });

  it("in a mark whose colour comes from a helper", () => {
    const found = plant(
      "mark",
      [
        'import styled from "styled-components";',
        "function dotColor(tone: string) {",
        '  return tone === "go" ? "var(--color-status-go-bg)" : "var(--color-accent-fg)";',
        "}",
        "const Dot = styled.span<{ $color: string }>`",
        `  background: \${({ $color }) => $color};`,
        "`;",
        'export const Go = () => <Dot $color={dotColor("go")} />;',
      ].join("\n"),
    );
    expect(found.map((f) => f.key)).toEqual([
      "Planted.tsx Dot: status-go-bg background on surface-panel",
    ]);
  });

  it("in an SVG fill", () => {
    const found = plant(
      "svg",
      [
        "export const Zone = ({ color }: { color?: string }) => (",
        "  <svg>",
        '    <rect fill={color ?? "var(--color-status-warning-fg)"} />',
        "  </svg>",
        ");",
      ].join("\n"),
    );
    expect(found.map((f) => f.key)).toEqual([
      "Planted.tsx <rect>: status-warning-fg fill on surface-panel",
    ]);
  });
});
