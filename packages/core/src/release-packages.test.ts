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
  bumpFromLog,
  compareVersions,
  importedScopePackages,
  listedNugetVersions,
  liveNpmVersions,
  main,
  nextRelease,
  plan,
  stampManifest,
  withdrawnVersions,
} from "../../../scripts/release-packages.mjs";

/**
 * Every published package carries one version, the release version, which is
 * the app's own. A release candidate is `<release>-rc.<run>` of every package
 * at once. What holds here is that the version never sorts at or below one
 * already published on any registry, that a spent tag is refused, and that a
 * packed manifest names every sibling at exactly its own version.
 */

const SDK = "@ksp-gonogo/sitrep-sdk";
const KIT = "@ksp-gonogo/ui-kit";
const TOOLS = "@ksp-gonogo/uplink-tools";

describe("compareVersions", () => {
  it("orders by core, then a prerelease below its release, then numerically", () => {
    expect(compareVersions("0.2.0", "0.1.9")).toBeGreaterThan(0);
    expect(compareVersions("0.2.0-rc.1", "0.2.0")).toBeLessThan(0);
    expect(compareVersions("0.2.0-rc.10", "0.2.0-rc.9")).toBeGreaterThan(0);
    expect(compareVersions("1.0.0", "1.0.0")).toBe(0);
  });
});

describe("bumpFromLog", () => {
  it("reads a break, a feature or neither from conventional subjects", () => {
    expect(bumpFromLog("feat(app)!: gone\n")).toBe("major");
    expect(bumpFromLog("fix: a\n\nBREAKING CHANGE: b\n")).toBe("major");
    expect(bumpFromLog("fix: a\nfeat(ui-kit): b\n")).toBe("minor");
    expect(bumpFromLog("fix: a\nchore: b\n")).toBe("patch");
  });

  it("refuses an empty range: that tree is already released", () => {
    expect(() => bumpFromLog("  \n")).toThrow(/already released/);
  });
});

describe("nextRelease", () => {
  it("moves the current release by the bump", () => {
    expect(nextRelease("1.0.0", "patch")).toBe("1.0.1");
    expect(nextRelease("1.0.3", "minor")).toBe("1.1.0");
    expect(nextRelease("1.2.3", "major")).toBe("2.0.0");
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
    expect([...importedScopePackages(source)].sort()).toEqual([SDK, KIT]);
  });
});

const siblings = new Set([SDK, KIT, TOOLS]);

describe("stampManifest", () => {
  it("sets the version, pins declared siblings and adds an imported workspace sibling as an exact peer", () => {
    const { manifest, pinned, added } = stampManifest(
      {
        name: TOOLS,
        version: "0.1.0",
        peerDependencies: { [KIT]: "*", react: "^18.0.0" },
      },
      "0.2.0-rc.7",
      siblings,
      {
        devDependencies: {
          "@ksp-gonogo/components": "workspace:*",
          [SDK]: "workspace:*",
          [KIT]: "workspace:*",
        },
      },
      new Set([SDK, KIT]),
    );
    expect(manifest.version).toBe("0.2.0-rc.7");
    expect(manifest.peerDependencies).toEqual({
      [KIT]: "0.2.0-rc.7",
      [SDK]: "0.2.0-rc.7",
      react: "^18.0.0",
    });
    expect(pinned).toEqual([`peerDependencies.${KIT}`]);
    expect(added).toEqual([`peerDependencies.${SDK}`]);
    expect(auditManifest(manifest, "0.2.0-rc.7", siblings)).toEqual([]);
  });

  it("adds no peer for a sibling the dist does not import", () => {
    const { manifest } = stampManifest(
      { name: KIT, version: "0.1.0" },
      "0.2.0",
      siblings,
      { devDependencies: { [SDK]: "workspace:*" } },
      new Set(),
    );
    expect(manifest.peerDependencies).toBeUndefined();
  });
});

describe("auditManifest", () => {
  it("names a version that is not the planned one and a sibling range that is not exact", () => {
    expect(
      auditManifest(
        {
          name: TOOLS,
          version: "0.1.0",
          peerDependencies: { [KIT]: "^0.2.0" },
        },
        "0.2.0",
        siblings,
      ),
    ).toEqual([
      "version is 0.1.0, the release is 0.2.0",
      `peerDependencies.${KIT} is ^0.2.0, not exactly 0.2.0`,
    ]);
  });

  it("names a scoped dependency that is not a published sibling", () => {
    expect(
      auditManifest(
        {
          name: KIT,
          version: "0.2.0",
          dependencies: { "@ksp-gonogo/theme": "0.2.0" },
        },
        "0.2.0",
        siblings,
      ),
    ).toEqual([
      "dependencies.@ksp-gonogo/theme is not a published package of this release",
    ]);
  });
});

describe("plan", () => {
  let root: string;
  const put = (file: string, text: string) => {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    writeFileSync(join(root, file), text);
  };
  const manifest = (fields: object) =>
    `${JSON.stringify({ exports: { ".": "./dist/index.js" }, ...fields })}\n`;

  let npm: Record<string, string[]>;
  let nuget: string[];
  let tags: string[];
  const registries = () => ({
    npmVersions: (name: string) => npm[name] ?? [],
    nugetVersions: nuget,
    tags,
  });

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "release-packages-"));
    put(
      "packages/app/package.json",
      `${JSON.stringify({ name: "@ksp-gonogo/app", version: "1.0.0", private: true })}\n`,
    );
    put(
      "mod/sitrep-sdk/package.json",
      manifest({ name: SDK, version: "0.0.1" }),
    );
    put(
      "packages/ui-kit/package.json",
      manifest({
        name: KIT,
        version: "0.1.0",
        devDependencies: { [SDK]: "workspace:*" },
      }),
    );
    put(
      "packages/uplink-tools/package.json",
      manifest({
        name: TOOLS,
        version: "0.1.0",
        peerDependencies: { [KIT]: "*" },
      }),
    );
    put(
      "packages/theme/package.json",
      manifest({ name: "@ksp-gonogo/theme", version: "0.0.0", private: true }),
    );
    npm = { [SDK]: ["0.0.1"], [KIT]: ["0.1.0"] };
    nuget = [];
    tags = ["v1.0.0", "rc-abc1234"];
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("gives every published package, and nothing private, the one release version", () => {
    const out = plan({ root, release: "0.2.0", ...registries() });
    expect(out).toEqual({
      release: "0.2.0",
      version: "0.2.0",
      tag: "v0.2.0",
      packages: {
        [SDK]: { dir: "mod/sitrep-sdk", firstVersion: false },
        [KIT]: { dir: "packages/ui-kit", firstVersion: false },
        [TOOLS]: { dir: "packages/uplink-tools", firstVersion: true },
      },
      nuget: { id: "KspGonogo.Sitrep.Contract", firstVersion: true },
    });
  });

  it("suffixes every package with the run number for an RC", () => {
    const out = plan({ root, release: "0.2.0", run: 43, ...registries() });
    expect(out.version).toBe("0.2.0-rc.43");
  });

  it("refuses a release at or below a version already on npm", () => {
    expect(() => plan({ root, release: "0.1.0", ...registries() })).toThrow(
      /@ksp-gonogo\/ui-kit has 0\.1\.0 published, which does not sort below 0\.1\.0/,
    );
    expect(() =>
      plan({ root, release: "0.1.0", run: 3, ...registries() }),
    ).toThrow(/ui-kit has 0\.1\.0 published/);
  });

  it("refuses a release at or below a version already on nuget.org", () => {
    nuget = ["29.16.0"];
    expect(() => plan({ root, release: "2.0.0", ...registries() })).toThrow(
      /KspGonogo\.Sitrep\.Contract has 29\.16\.0 published/,
    );
  });

  it("allows a release above an RC of itself", () => {
    npm[SDK] = ["0.0.1", "0.2.0-rc.43"];
    expect(plan({ root, release: "0.2.0", ...registries() }).version).toBe(
      "0.2.0",
    );
  });

  describe("a withdrawn version", () => {
    const withdrawn = [{ version: "2.0.0-rc.23", reason: "wrong line" }];
    const published = () => {
      npm[SDK] = ["0.0.1", "2.0.0-rc.23"];
      npm[KIT] = ["0.1.0", "2.0.0-rc.23"];
      nuget = ["2.0.0-rc.23"];
      tags = [];
    };

    it("does not block a lower version on any registry", () => {
      published();
      const out = plan({
        root,
        release: "1.0.0",
        run: 24,
        ...registries(),
        withdrawn,
      });
      expect(out.version).toBe("1.0.0-rc.24");
      expect(
        plan({ root, release: "1.0.0", ...registries(), withdrawn }).version,
      ).toBe("1.0.0");
    });

    it("blocks it when it is not withdrawn, so the case above proves the list", () => {
      published();
      expect(() =>
        plan({
          root,
          release: "1.0.0",
          run: 24,
          ...registries(),
          withdrawn: [],
        }),
      ).toThrow(/has 2\.0\.0-rc\.23 published/);
    });

    it("is never planned again", () => {
      tags = [];
      expect(() =>
        plan({ root, release: "2.0.0", run: 23, ...registries(), withdrawn }),
      ).toThrow(/2\.0\.0-rc\.23 was withdrawn \(wrong line\).*never reused/);
    });

    it("leaves a package with nothing else published a first version", () => {
      npm[SDK] = ["2.0.0-rc.23"];
      tags = [];
      const out = plan({
        root,
        release: "1.0.0",
        ...registries(),
        withdrawn,
      });
      expect(out.packages[SDK].firstVersion).toBe(true);
    });
  });

  it("refuses a release whose tag is already spent, RC or not", () => {
    expect(() => plan({ root, release: "1.0.0", ...registries() })).toThrow(
      /the tag v1\.0\.0 already exists/,
    );
    expect(() =>
      plan({ root, release: "1.0.0", run: 5, ...registries() }),
    ).toThrow(/the tag v1\.0\.0 already exists/);
  });

  it("lets an RC run find its own RC already published, so a re-run attempt can skip it", () => {
    npm[SDK] = ["0.0.1", "0.2.0-rc.43"];
    expect(
      plan({ root, release: "0.2.0", run: 43, ...registries() }).version,
    ).toBe("0.2.0-rc.43");
    expect(() =>
      plan({ root, release: "0.2.0", run: 42, ...registries() }),
    ).toThrow(
      /0\.2\.0-rc\.43 published, which does not sort below 0\.2\.0-rc\.42/,
    );
  });

  it("refuses a version that is not plain X.Y.Z, and a run that is not a positive integer", () => {
    expect(() => plan({ root, release: "0.2", ...registries() })).toThrow(
      /not a release version/,
    );
    expect(() =>
      plan({ root, release: "0.2.0-rc.1", ...registries() }),
    ).toThrow(/not a release version/);
    expect(() =>
      plan({ root, release: "0.2.0", run: 0, ...registries() }),
    ).toThrow(/run number/);
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
  const run = async (argv: string[], log = "feat: a\n") => {
    const printed: string[] = [];
    const result = await main(argv, {
      root,
      npm: (name: string) => (name === KIT ? ["0.1.0"] : []),
      nuget: async () => [],
      tags: () => ["v1.0.0"],
      log: () => log,
      print: (line: string) => printed.push(line),
    });
    return { result, printed };
  };

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "release-packages-main-"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    put(
      "packages/app/package.json",
      `${JSON.stringify({ name: "@ksp-gonogo/app", version: "1.0.0", private: true })}\n`,
    );
    put(
      "mod/sitrep-sdk/package.json",
      manifest({ name: SDK, version: "0.0.1" }),
    );
    put(
      "packages/ui-kit/package.json",
      manifest({
        name: KIT,
        version: "0.1.0",
        devDependencies: { [SDK]: "workspace:*" },
      }),
    );
  });
  afterEach(() => {
    vi.restoreAllMocks();
    rmSync(root, { recursive: true, force: true });
  });

  it("plans the next release from the app's version and the commits since its tag", async () => {
    const { printed } = await run(["plan", "--bump", "auto", "--rc", "12"]);
    expect(JSON.parse(printed[0])).toMatchObject({
      release: "1.1.0",
      version: "1.1.0-rc.12",
    });
  });

  it("takes an explicit version over any bump, and validates it the same way", async () => {
    const { printed } = await run(["plan", "--version", "0.2.0"]);
    expect(JSON.parse(printed[0]).version).toBe("0.2.0");
    await expect(run(["plan", "--version", "0.1.0"])).rejects.toThrow(
      /ui-kit has 0\.1\.0 published/,
    );
  });

  it("writes nothing to the tree", async () => {
    const files = [
      "packages/app/package.json",
      "mod/sitrep-sdk/package.json",
      "packages/ui-kit/package.json",
    ];
    const before = files.map((f) => readFileSync(join(root, f), "utf8"));
    await run(["plan", "--bump", "patch", "--rc", "4"]);
    expect(files.map((f) => readFileSync(join(root, f), "utf8"))).toEqual(
      before,
    );
  });

  it("stamps a packed tarball and the check reads it back exact", async () => {
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

    const stamped = (
      await run(["stamp", tarball, "0.2.0-rc.12", join(root, "out")])
    ).printed[0];
    const checked = await run(["check", stamped, "0.2.0-rc.12"]);
    expect(checked.printed[0]).toBe(
      "@ksp-gonogo/ui-kit@0.2.0-rc.12: peerDependencies.@ksp-gonogo/sitrep-sdk = 0.2.0-rc.12, each exact",
    );
    await expect(run(["check", tarball, "0.2.0-rc.12"])).rejects.toThrow(
      /version is 0\.1\.0, the release is 0\.2\.0-rc\.12/,
    );
  });
});

describe("what the registries say is still published", () => {
  it("drops an npm version that is deprecated and keeps the rest", () => {
    expect(
      liveNpmVersions({
        versions: {
          "1.0.0": {},
          "2.0.0-rc.23": { deprecated: "wrong line" },
        },
      }),
    ).toEqual(["1.0.0"]);
    expect(liveNpmVersions({})).toEqual([]);
  });

  it("drops a nuget version whose registration says it is unlisted", () => {
    const leaf = (version: string, listed?: boolean) => ({
      catalogEntry: { version, ...(listed === undefined ? {} : { listed }) },
    });
    expect(
      listedNugetVersions([
        leaf("1.0.0-rc.21", true),
        leaf("1.0.0-rc.22"),
        leaf("2.0.0-rc.23", false),
      ]),
    ).toEqual(["1.0.0-rc.21", "1.0.0-rc.22"]);
  });
});

describe("the committed list of withdrawn versions", () => {
  it("names 2.0.0-rc.23, each entry with a reason and no version twice", () => {
    const list = withdrawnVersions();
    expect(list.map((e: { version: string }) => e.version)).toContain(
      "2.0.0-rc.23",
    );
    for (const entry of list) expect(entry.reason.length).toBeGreaterThan(10);
    const versions = list.map((e: { version: string }) => e.version);
    expect(new Set(versions).size).toBe(versions.length);
  });

  it("refuses an entry without a reason", () => {
    const root = mkdtempSync(join(tmpdir(), "withdrawn-"));
    try {
      mkdirSync(join(root, "scripts"));
      writeFileSync(
        join(root, "scripts/withdrawn-versions.json"),
        JSON.stringify([{ version: "9.9.9" }]),
      );
      expect(() => withdrawnVersions(root)).toThrow(
        /needs a version and a reason/,
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
