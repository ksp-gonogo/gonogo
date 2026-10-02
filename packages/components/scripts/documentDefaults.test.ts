// @vitest-environment node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { documentDefaults } from "./widgetRenderHarness";

const APP_GLOBAL_CSS = resolve(__dirname, "../../app/src/styles/global.css");

describe("the probe pages' document defaults", () => {
  it("are the app's own body font rule", () => {
    const css = documentDefaults(readFileSync(APP_GLOBAL_CSS, "utf8"));
    expect(css).toContain("font-size: var(--font-size-compact)");
    expect(css).toContain("font-family: var(--font-family-mono)");
  });

  it("skips a body rule that sits inside a comment", () => {
    const css = documentDefaults(
      "/* body { font-size: 99px; } */ body { font-size: 11px; color: red; }",
    );
    expect(css).toContain("font-size: 11px");
    expect(css).not.toContain("99px");
    expect(css).not.toContain("color");
  });

  it("refuses a stylesheet whose body rule sets no size", () => {
    expect(() => documentDefaults("body { margin: 0; }")).toThrow(/font-size/);
  });
});
