// @vitest-environment node
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { check } from "../command";
import { CheckUnableError } from "../program";
import {
  checkLoadable,
  EXEMPT,
  type LoadResult,
  loadInBareNode,
} from "./loadable";
import { checkMinSize } from "./minsize";

const scratch: string[] = [];
afterEach(() => {
  for (const dir of scratch.splice(0))
    rmSync(dir, { recursive: true, force: true });
});

/** A client whose node_modules holds the named @ksp-gonogo packages, each exporting `exports`. */
function clientWith(
  packages: Record<string, string[]>,
  repository = "git+https://github.com/ksp-gonogo/gonogo.git",
): string {
  const dir = mkdtempSync(join(tmpdir(), "uplink-probe-"));
  scratch.push(dir);
  const dependencies: Record<string, string> = {};
  for (const [name, subpaths] of Object.entries(packages)) {
    dependencies[name] = "1.0.0";
    const pkgDir = join(dir, "node_modules", name);
    mkdirSync(pkgDir, { recursive: true });
    const exports: Record<string, string> = { ".": "./index.js" };
    for (const sub of subpaths) exports[`./${sub}`] = `./${sub}.js`;
    writeFileSync(
      join(pkgDir, "package.json"),
      JSON.stringify({
        name,
        version: "1.0.0",
        type: "module",
        exports,
        repository: { type: "git", url: repository },
      }),
    );
    writeFileSync(join(pkgDir, "index.js"), "export const x = 1;\n");
    for (const sub of subpaths) {
      writeFileSync(join(pkgDir, `${sub}.js`), "export const y = 1;\n");
    }
  }
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({ name: "client", version: "0.0.1", dependencies }),
  );
  return dir;
}

const SIX = {
  "@ksp-gonogo/a": ["one", "two", "three", "four", "five"],
};

describe("loadable", () => {
  it("passes when every entry point imports in a bare node", () => {
    expect(checkLoadable(clientWith(SIX))).toEqual([]);
  });

  it("leaves a package from another repository to the bundle that inlines it", () => {
    const dir = clientWith(
      { "@ksp-gonogo/other": ["one", "two"] },
      "git+https://github.com/someone-else/their-sdk.git",
    );
    writeFileSync(
      join(dir, "node_modules/@ksp-gonogo/other/one.js"),
      "import './missing-extension';\n",
    );
    const gonogo = clientWith(SIX);
    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify({
        name: "client",
        version: "0.0.1",
        dependencies: {
          "@ksp-gonogo/other": "1.0.0",
          "@ksp-gonogo/a": "1.0.0",
        },
      }),
    );
    cpSync(
      join(gonogo, "node_modules/@ksp-gonogo/a"),
      join(dir, "node_modules/@ksp-gonogo/a"),
      { recursive: true },
    );
    expect(checkLoadable(dir)).toEqual([]);
  });

  it("names the entry point that does not import, and why", () => {
    const dir = clientWith(SIX);
    writeFileSync(
      join(dir, "node_modules/@ksp-gonogo/a/three.js"),
      "import './missing-extension';\n",
    );
    const findings = checkLoadable(dir);
    expect(findings).toHaveLength(1);
    expect(findings[0].rule).toBe("loadable/entry-point");
    expect(findings[0].severity).toBe("error");
    expect(findings[0].message).toContain("@ksp-gonogo/a/three");
    expect(findings[0].message).toMatch(/Error/);
  });

  it("fails as BLIND when the loader reports a planted module that throws as loading", () => {
    const loadsEverything = (): LoadResult => ({ ok: true, cause: "" });
    expect(() =>
      checkLoadable(clientWith(SIX), { load: loadsEverything }),
    ).toThrow(/BLIND/);
  });

  it("fails as BLIND when the loader reports a planted good module as failing", () => {
    const failsEverything = (): LoadResult => ({ ok: false, cause: "Error" });
    expect(() =>
      checkLoadable(clientWith(SIX), { load: failsEverything }),
    ).toThrow(CheckUnableError);
  });

  it("stops rather than pass when too few entry points were found", () => {
    expect(() =>
      checkLoadable(clientWith({ "@ksp-gonogo/a": ["one"] })),
    ).toThrow(/found only 2 published entry point/);
  });

  it("stops rather than skip a package that is depended on and not installed", () => {
    const dir = clientWith(SIX);
    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify({
        name: "client",
        version: "0.0.1",
        dependencies: { "@ksp-gonogo/a": "1.0.0", "@ksp-gonogo/gone": "1.0.0" },
      }),
    );
    expect(() => checkLoadable(dir)).toThrow(
      /@ksp-gonogo\/gone is depended on/,
    );
  });

  it("warns when an entry point it treats as unloadable now loads", () => {
    const dir = clientWith({
      "@ksp-gonogo/ui-kit": ["testing", "one", "two", "three", "four"],
    });
    const findings = checkLoadable(dir);
    expect(
      findings
        .filter((f) => f.rule === "loadable/stale-exemption")
        .map((f) => f.severity),
    ).toEqual(["warning", "warning"]);
    expect(Object.keys(EXEMPT)).toContain("@ksp-gonogo/ui-kit");
  });

  it("loads a module and reports the first error line of one that throws", () => {
    const dir = mkdtempSync(join(tmpdir(), "uplink-probe-"));
    scratch.push(dir);
    writeFileSync(join(dir, "bad.mjs"), 'throw new TypeError("planted");\n');
    expect(loadInBareNode("./bad.mjs", dir)).toMatchObject({
      ok: false,
      cause: expect.stringContaining("TypeError"),
    });
  });
});

describe("minsize", () => {
  const widget = {
    id: "gauge",
    name: "Gauge",
    minSize: { w: 3, h: 2 },
    declaredTopics: [],
  };

  it("reports one finding per widget that is unreadable at its own minimum", async () => {
    const findings = await checkMinSize("/client", async () => ({
      swept: 2,
      misfits: [
        {
          widget,
          findings: [
            {
              kind: "title-clipped",
              px: 12,
              axis: "x",
              text: "Altitude above the surface",
            },
          ],
        },
      ],
    }));
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      rule: "minsize/misfit",
      severity: "error",
    });
    expect(findings[0].message).toContain("gauge");
    expect(findings[0].message).toContain("3x2");
    expect(findings[0].message).toContain("title-clipped 12px");
    expect(findings[0].fix).toContain("compactTitle");
  });

  it("finds nothing when every widget fits", async () => {
    expect(
      await checkMinSize("/client", async () => ({ swept: 3, misfits: [] })),
    ).toEqual([]);
  });
});

describe("check --only for the groups that start a process", () => {
  it("refuses a group that does not exist, naming the real ones", async () => {
    const dir = clientWith(SIX);
    writeFileSync(join(dir, "tsconfig.json"), "{}");
    const errors: string[] = [];
    const log = console.error;
    console.error = (m: string) => errors.push(m);
    try {
      expect(await check(["--client", dir, "--only", "nope"])).toBe(2);
    } finally {
      console.error = log;
    }
    expect(errors.join("")).toContain("loadable, minsize");
  });

  it("runs loadable on its own without reading the client's source", async () => {
    const dir = clientWith(SIX);
    writeFileSync(join(dir, "tsconfig.json"), "{}");
    const out: string[] = [];
    const log = console.log;
    console.log = (m: string) => out.push(m);
    try {
      expect(await check(["--client", dir, "--only", "loadable"])).toBe(0);
    } finally {
      console.log = log;
    }
    expect(out.join("\n")).toContain("check: nothing found");
  });
});
