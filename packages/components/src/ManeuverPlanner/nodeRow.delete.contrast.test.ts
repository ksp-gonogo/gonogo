// @vitest-environment node
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const TOKENS = readFileSync(
  join(
    dirname(fileURLToPath(import.meta.url)),
    "../../../theme/src/tokens.css",
  ),
  "utf8",
);

/** A token's colour, followed through `var()` aliases to a hex literal. */
function colour(name: string): [number, number, number] {
  const m = new RegExp(`--${name}:\\s*([^;]+);`).exec(TOKENS);
  if (!m) throw new Error(`no token ${name}`);
  const raw = m[1].trim();
  const alias = /^var\(--([a-z0-9-]+)\)$/.exec(raw);
  if (alias) return colour(alias[1]);
  const hex = raw.replace("#", "");
  const full =
    hex.length === 3
      ? hex
          .split("")
          .map((c) => c + c)
          .join("")
      : hex;
  return [0, 2, 4].map((i) => Number.parseInt(full.slice(i, i + 2), 16)) as [
    number,
    number,
    number,
  ];
}

const channel = (c: number) => {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};
const luminance = ([r, g, b]: [number, number, number]) =>
  0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
function contrast(a: [number, number, number], b: [number, number, number]) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** The planned node row's own background. */
const ROW = colour("color-surface-panel");

describe("NodeRow delete control contrast on the node row", () => {
  it.each([
    ["the x and the send arrow", "color-text-faint"],
    ["the x after a refusal or no reply", "color-warn-text"],
    ["the keyboard focus ring", "color-focus"],
  ])("%s is at least 3:1", (_name, token) => {
    expect(contrast(colour(token), ROW)).toBeGreaterThanOrEqual(3);
  });
});
