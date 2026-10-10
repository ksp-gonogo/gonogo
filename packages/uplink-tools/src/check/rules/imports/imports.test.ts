import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PACKAGE_JSON, uplinkOn } from "../fixture";
import { importFault, importsRule, UPLINK_TOOLS_SUBPATHS } from "./index";

const ctx = (clientDir: string) => ({
  clientDir,
  scan: undefined as never,
  dynamicPrefixes: [],
});
const check = (files: Record<string, string>) => {
  const { clientDir } = uplinkOn({
    "client/package.json": PACKAGE_JSON(),
    ...Object.fromEntries(
      Object.entries(files).map(([name, text]) => [`client/src/${name}`, text]),
    ),
  });
  return importsRule.check(ctx(clientDir));
};

describe("imports/source", () => {
  it("passes the published packages and the permitted subpaths", () => {
    expect(
      check({
        "a.tsx": `import { registerComponent } from "@ksp-gonogo/sitrep-sdk";
import { Panel } from "@ksp-gonogo/ui-kit";
import type { Frame } from "@ksp-gonogo/sitrep-sdk/frames";
import { x } from "@ksp-gonogo/sitrep-sdk/media";
import React from "react";
export { x };
`,
      }),
    ).toEqual([]);
  });

  it("fails an import of a private package of the repository, with its line", () => {
    const [finding] = check({
      "a.ts": `import { a } from "@ksp-gonogo/sitrep-sdk";\nimport { b } from "@ksp-gonogo/core";\n`,
    });
    expect(finding.rule).toBe("imports/private-package");
    expect(finding.severity).toBe("error");
    expect(finding.line).toBe(2);
    expect(finding.message).toContain("@ksp-gonogo/core");
  });

  it.each([
    ["a re-export", `export { x } from "@ksp-gonogo/components";`],
    ["a dynamic import", `const m = await import("@ksp-gonogo/data");`],
    ["a type import", `import type { T } from "@ksp-gonogo/logger";`],
    ["a side-effect import", `import "@ksp-gonogo/ui";`],
  ])("sees %s", (_name, source) => {
    expect(check({ "a.ts": source })[0]?.rule).toBe("imports/private-package");
  });

  it("fails a subpath of the sdk that is not an author surface", () => {
    const findings = check({
      "a.ts": `import { a } from "@ksp-gonogo/sitrep-sdk/spine";\nimport { b } from "@ksp-gonogo/sitrep-sdk/registry";\n`,
    });
    expect(findings.map((f) => f.rule)).toEqual([
      "imports/sdk-subpath",
      "imports/sdk-subpath",
    ]);
  });

  it("fails a specifier the app's import map does not resolve, outside a test file only", () => {
    const source = `import { stub } from "@ksp-gonogo/sitrep-sdk/testing";\n`;
    const [finding] = check({ "widget.tsx": source });
    expect(finding.rule).toBe("imports/not-in-import-map");
    expect(check({ "widget.test.tsx": source })).toEqual([]);
  });

  it("allows the published uplink-tools entry points in test code, not in bundle code", () => {
    const source = `import { expectUplinkPageCurrent } from "@ksp-gonogo/uplink-tools/page-check";\n`;
    expect(check({ "uplink-page.test.ts": source })).toEqual([]);
    expect(check({ "widget.tsx": source })[0]?.rule).toBe(
      "imports/not-in-import-map",
    );
    expect(
      check({
        "t.test.ts": `import { a } from "@ksp-gonogo/uplink-tools/internal";`,
      })[0]?.rule,
    ).toBe("imports/uplink-tools-subpath");
  });

  it("names every entry point the uplink-tools export map publishes", () => {
    const exported = Object.keys(
      JSON.parse(
        readFileSync(
          join(import.meta.dirname, "../../../../package.json"),
          "utf8",
        ),
      ).exports,
    )
      .filter((key) => key !== "." && key !== "./package.json")
      .map((key) => key.slice(2))
      .sort();
    expect([...UPLINK_TOOLS_SUBPATHS].sort()).toEqual(exported);
  });

  it("treats test setup under a test directory as test code", () => {
    const source = `import { stub } from "@ksp-gonogo/sitrep-sdk/testing";\n`;
    expect(check({ "test/setup.ts": source })).toEqual([]);
    expect(check({ "setup.ts": source })[0]?.rule).toBe(
      "imports/not-in-import-map",
    );
  });

  it("holds a test file to the published packages all the same", () => {
    expect(
      check({ "widget.test.tsx": `import { a } from "@ksp-gonogo/core";` })[0]
        ?.rule,
    ).toBe("imports/private-package");
  });

  it("ignores the word in a comment or a string", () => {
    expect(
      check({
        "a.ts": `// import { a } from "@ksp-gonogo/core";\nexport const s = "from '@ksp-gonogo/core'";\n`,
      }),
    ).toEqual([]);
  });

  it("judges a bare specifier of this ecosystem and no other", () => {
    expect(importFault("lodash", false)).toBeUndefined();
    expect(importFault("@ksp-gonogo/ui-kit", false)).toBeUndefined();
  });
});
