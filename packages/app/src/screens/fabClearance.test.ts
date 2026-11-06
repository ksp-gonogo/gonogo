import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));
const read = (p: string) => readFileSync(resolve(HERE, p), "utf8");

const layoutBlock = (source: string) => {
  const start = source.indexOf("const Layout = styled.div`");
  return source.slice(start, source.indexOf("`;", start));
};

describe("dashboard room under the floating controls button", () => {
  it("the button is placed and sized from the fab tokens", () => {
    const toggle = read("../../../ui/src/FabClusterToggle.tsx");
    expect(toggle).toMatch(/width:\s*var\(--fab-size\)/);
    expect(toggle).toMatch(/height:\s*var\(--fab-size\)/);
    expect(toggle).toMatch(
      /bottom:\s*calc\(var\(--fab-edge\) \+ env\(safe-area-inset-bottom/,
    );
  });

  it("the tokens exist", () => {
    const tokens = read("../../../theme/src/tokens.css");
    expect(tokens).toMatch(/--fab-size:\s*48px;/);
    expect(tokens).toMatch(/--fab-edge:\s*var\(--[\w-]+\);/);
  });

  it.each([
    ["MainScreen.tsx"],
    ["StationScreen.tsx"],
  ])("%s scrolls its last tile clear of the button", (file) => {
    const bottom = layoutBlock(read(file)).match(/padding-bottom:[^;]*;/)?.[0];
    expect(bottom).toContain("var(--fab-size)");
    expect(bottom).toContain("var(--fab-edge)");
    expect(bottom).toContain("env(safe-area-inset-bottom");
  });
});
