import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const html = readFileSync(resolve(__dirname, "../index.html"), "utf-8");

describe("index.html asset links", () => {
  it("are root-absolute so every route, /station included, resolves them against the base path", () => {
    const hrefs = [...html.matchAll(/<link\b[^>]*\bhref="([^"]+)"/g)].map(
      (m) => m[1],
    );
    expect(hrefs.length).toBeGreaterThan(0);
    for (const href of hrefs) {
      expect(href, href).toMatch(/^\//);
    }
  });
});
