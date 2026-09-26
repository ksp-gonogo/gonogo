import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { MARKER_STATE_COLOURS } from "./SystemDiagram";

/** An undefined CSS custom property paints nothing and says nothing, so every token the diagram strokes with must be defined, and foreground `*-fg` tokens must not be used as strokes on a dark panel. */
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
