// @vitest-environment node
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { workspaceAliases } from "./workspaceAlias";

const uiKit = resolve(import.meta.dirname, "../ui-kit");

describe("workspaceAliases", () => {
  it("maps a subpath exported as built files to its source, ahead of the bare package", () => {
    const keys = Object.keys(workspaceAliases());
    expect(workspaceAliases()["@ksp-gonogo/ui-kit/grid"]).toBe(
      resolve(uiKit, "src/gridUnits.ts"),
    );
    expect(workspaceAliases()["@ksp-gonogo/ui-kit/guards"]).toBe(
      resolve(uiKit, "src/guards.ts"),
    );
    expect(keys.indexOf("@ksp-gonogo/ui-kit/grid")).toBeLessThan(
      keys.indexOf("@ksp-gonogo/ui-kit"),
    );
  });
});
