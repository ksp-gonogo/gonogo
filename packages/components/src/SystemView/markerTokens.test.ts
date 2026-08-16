import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { MARKER_STATE_COLOURS } from "./SystemDiagram";

/**
 * An undefined CSS custom property fails silently. `stroke="var(--nope)"`
 * paints nothing at all: no console warning, no thrown error, just a shape that
 * is not there. On a dark panel an unpainted stroke and a very dark one look
 * identical, so neither a reviewer nor a screenshot diff necessarily catches it.
 *
 * <p>Both happened here. The lost marker used `--color-status-critical-fg`,
 * which does not exist, so a craft declared lost lost its marker entirely, and
 * the overdue marker used `--color-status-warning-fg`, which is `#1a1a1a` — a
 * foreground meant to sit ON the orange warning background, not a stroke for a
 * dark panel. "Distinct amber" rendered as near-black.</p>
 *
 * <p>So: every token the diagram strokes with must actually be defined.</p>
 */
describe("SystemView marker colours", () => {
  const tokens = readFileSync(
    join(__dirname, "../../../theme/src/tokens.css"),
    "utf8",
  );

  const declared = new Set(
    Array.from(tokens.matchAll(/(--[a-z0-9-]+)\s*:/g), (m) => m[1]),
  );

  it("reads the token sheet", () => {
    expect(declared.size).toBeGreaterThan(20);
    expect(declared.has("--color-accent-fg")).toBe(true);
  });

  it.each(
    Object.entries(MARKER_STATE_COLOURS),
  )("%s uses a token that exists", (_state, colour) => {
    const name = /var\((--[a-z0-9-]+)\)/.exec(colour)?.[1];
    expect(name, `${colour} is not a var() reference`).toBeDefined();
    expect(declared.has(name as string)).toBe(true);
  });
});
