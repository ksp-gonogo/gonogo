// @vitest-environment node
import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  auditManifest,
  bump,
  importedScopePackages,
  main,
  nugetRc,
  pendingLevel,
  plan,
  planPackage,
  stampManifest,
} from "../../../scripts/rc-packages.mjs";

/**
 * `release.yml`'s RC mode publishes a prerelease of the version the next
 * release would carry, with every sibling pinned to the RC from the same run.
 * What holds here is that the version never sorts below a published one, that a
 * never-published package is refused, and that the packed manifest names its
 * siblings exactly.
 */

const ledgerText = (
  versioning: string,
  version: string,
  pending: { breaks: object[]; additions: object[] },
) =>
  JSON.stringify({
    typescript: "5.9.3",
    versioning,
    versionMoves: "at-release",
    entries: [{ version, note: "n", breaks: [], additions: [], floor: [] }],
    pending,
  });

const change = (key: string) => ({ key, note: "n" });

describe("bump", () => {
  it("moves a zero-major version by minor for a break, patch otherwise", () => {
    expect(bump("0.1.0", "break")).toBe("0.2.0");
    expect(bump("0.1.0", "addition")).toBe("0.1.1");
    expect(bump("0.1.0", "none")).toBe("0.1.1");
  });

  it("moves a 1.0+ version by semver", () => {
    expect(bump("2.3.4", "break")).toBe("3.0.0");
    expect(bump("2.3.4", "addition")).toBe("2.4.0");
    expect(bump("2.3.4", "none")).toBe("2.3.5");
  });
});

describe("pendingLevel", () => {
  it("reads the strongest change keyed to the package, from any ledger", () => {
    const sdkBreak = ledgerText("semver", "6.0.0", {
      breaks: [change("sitrep-sdk . X")],
      additions: [change("ui-kit . Y")],
    });
    expect(pendingLevel([sdkBreak], "@ksp-gonogo/sitrep-sdk")).toBe("break");
    expect(pendingLevel([sdkBreak], "@ksp-gonogo/ui-kit")).toBe("addition");
    expect(pendingLevel([sdkBreak], "@ksp-gonogo/uplink-tools")).toBe("none");
  });

  it("does not read one package's keys as a prefix of another's", () => {
    const text = ledgerText("semver", "6.0.0", {
      breaks: [change("ui-kit-extra . X")],
      additions: [],
    });
    expect(pendingLevel([text], "@ksp-gonogo/ui-kit")).toBe("none");
  });
});

describe("planPackage", () => {
  it("is the release version itself while that is unpublished", () => {
    expect(
      planPackage({
        release: "0.2.0",
        level: "break",
        published: ["0.1.0"],
        run: 7,
      }),
    ).toEqual({ base: "0.2.0", version: "0.2.0-rc.7", refused: null });
  });

  it("is the next version past a published one, never an RC of it", () => {
    const rc = planPackage({
      release: "0.1.0",
      level: "none",
      published: ["0.1.0"],
      run: 7,
    });
    expect(rc.version).toBe("0.1.1-rc.7");
  });

  it("refuses a version that would sort below one already out", () => {
    expect(() =>
      planPackage({
        release: "0.1.0",
        level: "none",
        published: ["0.1.0", "0.3.0"],
        run: 7,
      }),
    ).toThrow(/does not sort above the published 0\.3\.0/);
  });

  it("refuses a package that has never been published", () => {
    expect(
      planPackage({ release: "0.1.0", level: "none", published: [], run: 7 })
        .refused,
    ).toMatch(/latest/);
  });

  it("refuses a run number that is not a positive integer", () => {
    expect(() =>
      planPackage({
        release: "0.1.0",
        level: "none",
        published: ["0.0.1"],
        run: Number.NaN,
      }),
    ).toThrow(/run number/);
  });
});

describe("nugetRc", () => {
  it("is the tree's version until that is published, then its next patch", () => {
    expect(nugetRc("26.1.0", [], 9)).toBe("26.1.0-rc.9");
    expect(nugetRc("26.1.0", ["26.1.0"], 9)).toBe("26.1.1-rc.9");
  });
});

describe("importedScopePackages", () => {
  it("counts specifiers and ignores prose", () => {
    const source = [
      "/** see @ksp-gonogo/theme, inlined */",
      'import { a } from "@ksp-gonogo/sitrep-sdk/spine";',
      '// import "@ksp-gonogo/logger";',
      'export * from "@ksp-gonogo/ui-kit";',
    ].join("\n");
    expect([...importedScopePackages(source)].sort()).toEqual([
      "@ksp-gonogo/sitrep-sdk",
      "@ksp-gonogo/ui-kit",
    ]);
  });
});

const rcPlan = {
  run: 7,
  packages: {
    "@ksp-gonogo/sitrep-sdk": { dir: "mod/sitrep-sdk", version: "0.1.0-rc.7" },
    "@ksp-gonogo/ui-kit": { dir: "packages/ui-kit", version: "0.2.0-rc.7" },
    "@ksp-gonogo/uplink-tools": {
      dir: "packages/uplink-tools",
      version: "0.1.0-rc.7",
    },
  },
};

describe("stampManifest", () => {
  it("pins declared siblings and adds an imported workspace sibling as an exact peer", () => {
    const { manifest, pinned, added } = stampManifest(
      {
        name: "@ksp-gonogo/uplink-tools",
        version: "0.1.0",
        peerDependencies: { "@ksp-gonogo/ui-kit": "*", react: "^18.0.0" },
      },
      rcPlan,
      {
        devDependencies: {
          "@ksp-gonogo/components": "workspace:*",
          "@ksp-gonogo/sitrep-sdk": "workspace:*",
          "@ksp-gonogo/ui-kit": "workspace:*",
        },
      },
      new Set(["@ksp-gonogo/sitrep-sdk", "@ksp-gonogo/ui-kit"]),
    );
    expect(manifest.version).toBe("0.1.0-rc.7");
    expect(manifest.peerDependencies).toEqual({
      "@ksp-gonogo/ui-kit": "0.2.0-rc.7",
      "@ksp-gonogo/sitrep-sdk": "0.1.0-rc.7",
      react: "^18.0.0",
    });
    expect(pinned).toEqual(["peerDependencies.@ksp-gonogo/ui-kit"]);
    expect(added).toEqual(["peerDependencies.@ksp-gonogo/sitrep-sdk"]);
    expect(auditManifest(manifest, rcPlan)).toEqual([]);
  });

  it("adds no peer for a sibling the dist does not import", () => {
    const { manifest } = stampManifest(
      { name: "@ksp-gonogo/ui-kit", version: "0.1.0" },
      rcPlan,
      { devDependencies: { "@ksp-gonogo/sitrep-sdk": "workspace:*" } },
      new Set(),
    );
    expect(manifest.peerDependencies).toBeUndefined();
  });
});

describe("auditManifest", () => {
  it("names a sibling range that is not the exact RC, and a non-RC version", () => {
    expect(
      auditManifest(
        {
          name: "@ksp-gonogo/uplink-tools",
          version: "0.1.0",
          peerDependencies: { "@ksp-gonogo/ui-kit": "^0.2.0-rc.7" },
        },
        rcPlan,
      ),
    ).toEqual([
      "version is 0.1.0, the plan says 0.1.0-rc.7",
      "0.1.0 is not an -rc.<n> prerelease",
      "peerDependencies.@ksp-gonogo/ui-kit is ^0.2.0-rc.7, not exactly 0.2.0-rc.7",
    ]);
  });
});

describe("main", () => {
  let root: string;
  const put = (file: string, text: string) => {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    writeFileSync(join(root, file), text);
  };
  const manifest = (fields: object) =>
    `${JSON.stringify({ exports: { ".": "./dist/index.js" }, ...fields })}\n`;
  const seed = () => {
    put(
      "mod/sitrep-sdk/extension-api.ledger.json",
      ledgerText("semver", "6.0.0", {
        breaks: [change("sitrep-sdk . X")],
        additions: [],
      }),
    );
    put(
      "packages/uplink-tools/api-surface.ledger.json",
      ledgerText("zero-major", "0.1.0", {
        breaks: [],
        additions: [change("uplink-tools . Z")],
      }),
    );
    put(
      "mod/sitrep-sdk/package.json",
      manifest({ name: "@ksp-gonogo/sitrep-sdk", version: "0.0.1" }),
    );
    put(
      "packages/ui-kit/package.json",
      manifest({
        name: "@ksp-gonogo/ui-kit",
        version: "0.1.0",
        devDependencies: { "@ksp-gonogo/sitrep-sdk": "workspace:*" },
      }),
    );
    put(
      "packages/uplink-tools/package.json",
      manifest({
        name: "@ksp-gonogo/uplink-tools",
        version: "0.1.0",
        peerDependencies: { "@ksp-gonogo/ui-kit": "*" },
      }),
    );
    put(
      "packages/theme/package.json",
      manifest({ name: "@ksp-gonogo/theme", version: "0.0.0", private: true }),
    );
  };
  const published: Record<string, string[]> = {
    "@ksp-gonogo/sitrep-sdk": ["0.0.1"],
    "@ksp-gonogo/ui-kit": ["0.1.0"],
    "@ksp-gonogo/uplink-tools": ["0.1.0"],
  };
  const run = async (argv: string[]) => {
    const printed: string[] = [];
    const result = await main(argv, {
      root,
      npm: (name: string) => published[name] ?? [],
      nuget: async () => ["26.1.0"],
      print: (line: string) => printed.push(line),
    });
    return { result, printed };
  };

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "rc-packages-"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    seed();
  });
  afterEach(() => {
    vi.restoreAllMocks();
    rmSync(root, { recursive: true, force: true });
  });

  it("plans every published package and nothing private, from the ledgers and the registry", async () => {
    const { printed } = await run(["plan", "--run", "12"]);
    const planned = plan({
      root,
      run: 12,
      publishedVersions: (name: string) => published[name] ?? [],
    });
    expect(JSON.parse(printed[0])).toEqual(planned);
    expect(
      Object.fromEntries(
        Object.entries(planned.packages).map(([name, entry]) => [
          name,
          entry.version,
        ]),
      ),
    ).toEqual({
      "@ksp-gonogo/sitrep-sdk": "0.1.0-rc.12",
      "@ksp-gonogo/ui-kit": "0.1.1-rc.12",
      "@ksp-gonogo/uplink-tools": "0.1.1-rc.12",
    });
  });

  it("takes the freeze's planned version for a package a ledger moves", () => {
    const out = plan({
      root,
      run: 3,
      publishedVersions: (name: string) =>
        name === "@ksp-gonogo/uplink-tools" ? ["0.1.0"] : ["0.0.1"],
    });
    expect(out.packages["@ksp-gonogo/uplink-tools"]).toMatchObject({
      tree: "0.1.0",
      release: "0.1.1",
      version: "0.1.1-rc.3",
    });
  });

  it("writes nothing to the tree", async () => {
    const files = [
      "mod/sitrep-sdk/package.json",
      "packages/ui-kit/package.json",
      "packages/uplink-tools/package.json",
      "mod/sitrep-sdk/extension-api.ledger.json",
      "packages/uplink-tools/api-surface.ledger.json",
    ];
    const before = files.map((f) => readFileSync(join(root, f), "utf8"));
    await run(["plan", "--run", "12"]);
    expect(files.map((f) => readFileSync(join(root, f), "utf8"))).toEqual(
      before,
    );
  });

  it("stamps a packed tarball and the check reads it back exact", async () => {
    const { printed } = await run(["plan", "--run", "12"]);
    const planPath = join(root, "plan.json");
    writeFileSync(planPath, printed[0]);

    const pkg = join(root, "pack", "package");
    mkdirSync(join(pkg, "dist"), { recursive: true });
    writeFileSync(
      join(pkg, "package.json"),
      readFileSync(join(root, "packages/ui-kit/package.json")),
    );
    writeFileSync(
      join(pkg, "dist", "index.js"),
      'export * from "@ksp-gonogo/sitrep-sdk";\n',
    );
    const tarball = join(root, "ui-kit.tgz");
    execFileSync("tar", ["-czf", tarball, "-C", join(root, "pack"), "package"]);

    const stamped = (await run(["stamp", tarball, planPath, join(root, "out")]))
      .printed[0];
    const checked = await run(["check", stamped, planPath]);
    expect(checked.printed[0]).toBe(
      "@ksp-gonogo/ui-kit@0.1.1-rc.12: peerDependencies.@ksp-gonogo/sitrep-sdk = 0.1.0-rc.12, each exact",
    );
    await expect(run(["check", tarball, planPath])).rejects.toThrow(
      /not an -rc/,
    );
  });

  it("plans the NuGet RC past a published version", async () => {
    const { printed } = await run(["nuget", "--tree", "26.1.0", "--run", "4"]);
    expect(printed).toEqual(["26.1.1-rc.4"]);
  });
});
