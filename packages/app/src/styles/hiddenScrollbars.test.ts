import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(join(__dirname, "global.css"), "utf8");

describe("global scrollbar hiding", () => {
  it("hides the native bar in Firefox and in Chromium and WebKit", () => {
    expect(css).toMatch(/\*\s*\{\s*scrollbar-width:\s*none;/);
    expect(css).toMatch(/\*::-webkit-scrollbar\s*\{\s*display:\s*none;/);
  });
});
