import { execFileSync, spawn } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

/**
 * `bake` is exercised through the BIN, not the exported function, because the
 * bin is what an author's release script calls. A test that imports `run` would
 * pass with a broken shim, an absent `bin` entry, or a dist that does not load.
 */
const BIN = join(import.meta.dirname, "../../bin/uplink-tools.mjs");
const scratch: string[] = [];
const workdir = () => {
  const dir = mkdtempSync(join(tmpdir(), "gonogo-cli-"));
  scratch.push(dir);
  return dir;
};

afterEach(() => {
  for (const dir of scratch.splice(0))
    rmSync(dir, { recursive: true, force: true });
});

const runBin = (args: readonly string[], cwd?: string) => {
  try {
    const stdout = execFileSync(process.execPath, [BIN, ...args], {
      cwd,
      encoding: "utf8",
      stdio: "pipe",
    });
    return { code: 0, out: stdout };
  } catch (err) {
    const field = (key: string) =>
      String(
        (typeof err === "object" && err !== null
          ? Reflect.get(err, key)
          : "") ?? "",
      );
    return {
      code: Number(field("status")) || 1,
      out: `${field("stdout")}${field("stderr")}`,
    };
  }
};

/** An Uplink's directory as far as bake reads it: the declaration, the client's version and a mod folder. */
const uplinkDir = (declared: Record<string, unknown> = {}) => {
  const dir = workdir();
  mkdirSync(join(dir, "mod"));
  mkdirSync(join(dir, "client", "src"), { recursive: true });
  writeFileSync(
    join(dir, "uplink.json"),
    JSON.stringify({
      id: "x",
      name: "X",
      author: 'Jo "the hat" Kerman',
      repo: "https://example.test/x",
      csharpNamespace: "Gonogo.X",
      client: { url: "https://cdn.example.test/x/x.client.js" },
      ...declared,
    }),
  );
  writeFileSync(
    join(dir, "client", "package.json"),
    JSON.stringify({ name: "x", version: "1.4.0" }),
  );
  return dir;
};

const baked = (dir: string, file: string) =>
  readFileSync(join(dir, "mod", file), "utf8");

describe("uplink-tools bake", () => {
  it("writes where the client lives, who wrote it and the bundle's hash, from inside the Uplink", () => {
    const dir = uplinkDir();
    const bundle = join(dir, "x.client.js");
    writeFileSync(bundle, "export const marker = 1;\n");

    // Run from client/src, since an author runs it from wherever they are.
    execFileSync(process.execPath, [BIN, "bake", "--bundle", bundle], {
      cwd: join(dir, "client", "src"),
    });

    const provenance = baked(dir, "Provenance.g.cs");
    expect(provenance).toContain("namespace Gonogo.X");
    expect(provenance).toContain('Name = "X";');
    expect(provenance).toContain('Author = "Jo \\"the hat\\" Kerman";');
    expect(provenance).toContain('Repo = "https://example.test/x";');
    // One version for both halves: the client's package.json is where it is written.
    expect(provenance).toContain('Version = "1.4.0";');

    const source = baked(dir, "ClientSource.g.cs");
    expect(source).toContain('Url = "https://cdn.example.test/x/x.client.js";');
    expect(source).toContain('DevPath = "";');

    // The value the loader compares against, so its SHAPE is the contract: an `sha256-<64 hex>` it can match, never a bare digest.
    expect(baked(dir, "ExpectedClientHash.g.cs")).toMatch(
      /public const string Value = "sha256-[0-9a-f]{64}";/,
    );
  });

  it("bakes an empty hash without a bundle, and says the app will refuse the client", () => {
    const dir = uplinkDir();

    const out = execFileSync(process.execPath, [BIN, "bake"], {
      cwd: dir,
      encoding: "utf8",
    });

    expect(baked(dir, "ExpectedClientHash.g.cs")).toContain('Value = "";');
    expect(out).toMatch(/refuses the client/);
    expect(out).toContain("bake --bundle");
  });

  it("carries a dev path only when one was given, and says it must not ship", () => {
    const dir = uplinkDir();

    const out = execFileSync(
      process.execPath,
      [BIN, "bake", "--dev-path", "http://localhost:5173/x.client.js"],
      { cwd: dir, encoding: "utf8" },
    );

    expect(baked(dir, "ClientSource.g.cs")).toContain(
      'DevPath = "http://localhost:5173/x.client.js";',
    );
    expect(out).toContain("DEV BUILD");
  });

  it("announces no client for an Uplink that declares none", () => {
    const dir = uplinkDir({ client: undefined });

    const out = execFileSync(process.execPath, [BIN, "bake"], {
      cwd: dir,
      encoding: "utf8",
    });

    expect(existsSync(join(dir, "mod", "Provenance.g.cs"))).toBe(true);
    expect(existsSync(join(dir, "mod", "ClientSource.g.cs"))).toBe(false);
    expect(out).toContain("announces no client");
  });

  it("bakes an Uplink that has no client half, which has no client package to take a version from", () => {
    const dir = workdir();
    mkdirSync(join(dir, "mod"));
    writeFileSync(
      join(dir, "uplink.json"),
      JSON.stringify({
        id: "modonly",
        name: "Mod only",
        csharpNamespace: "Gonogo.ModOnly",
      }),
    );

    const out = execFileSync(process.execPath, [BIN, "bake"], {
      cwd: dir,
      encoding: "utf8",
    });

    expect(baked(dir, "Provenance.g.cs")).toContain('Name = "Mod only";');
    expect(existsSync(join(dir, "mod", "ClientSource.g.cs"))).toBe(false);
    expect(out).toContain("announces no client");
  });

  it("refuses a bundle that does not exist rather than baking a hash of nothing", () => {
    const dir = uplinkDir();
    const { code, out } = runBin(
      ["bake", "--bundle", join(dir, "absent.js")],
      dir,
    );
    expect(code).toBe(1);
    expect(out).toContain("does not exist");
    expect(existsSync(join(dir, "mod", "ExpectedClientHash.g.cs"))).toBe(false);
  });

  it("refuses to run outside an Uplink, naming what it looked for", () => {
    const { code, out } = runBin(["bake"], workdir());
    expect(code).toBe(1);
    expect(out).toContain("no uplink.json");
  });
});

describe("uplink-tools package", () => {
  /** A built mod as far as package reads it: the plugin, its slice, a licence, a notice and a stray file. */
  const builtMod = () => {
    const dir = uplinkDir({
      gamedata: "GonogoXUplink",
      dll: "GonogoXUplink.dll",
    });
    const bin = join(dir, "mod", "bin", "Release");
    mkdirSync(bin, { recursive: true });
    mkdirSync(join(dir, "mod-contract"));
    writeFileSync(join(bin, "GonogoXUplink.dll"), "plugin bytes");
    writeFileSync(join(bin, "GonogoXUplink.Contract.dll"), "slice bytes");
    // GonogoCore provides this one in the game, so it must never be zipped.
    writeFileSync(join(bin, "Sitrep.Contract.dll"), "not ours to ship");
    writeFileSync(join(dir, "mod", "LICENSE"), "MIT");
    writeFileSync(join(dir, "mod", "NOTICE-X.txt"), "notice");
    writeFileSync(join(dir, "mod", "GonogoXUplink.netkan"), "{}");
    return dir;
  };

  it("zips the plugin, its own slice, the licence and notices, and nothing of Gonogo's", () => {
    const dir = builtMod();

    execFileSync(process.execPath, [BIN, "package"], { cwd: dir });

    const zip = join(dir, "dist", "GonogoXUplink.zip");
    const listed = execFileSync("unzip", ["-Z1", zip], { encoding: "utf8" })
      .split("\n")
      .filter(Boolean);
    expect(listed).toEqual([
      "GonogoXUplink/LICENSE",
      "GonogoXUplink/NOTICE-X.txt",
      "GonogoXUplink/Plugins/GonogoXUplink.Contract.dll",
      "GonogoXUplink/Plugins/GonogoXUplink.dll",
    ]);
    // Read back through a real unzip, so the archive is one other tools open and its bytes survive.
    expect(
      execFileSync(
        "unzip",
        ["-p", zip, "GonogoXUplink/Plugins/GonogoXUplink.dll"],
        {
          encoding: "utf8",
        },
      ),
    ).toBe("plugin bytes");
    expect(existsSync(join(dir, "dist", "GonogoXUplink.netkan"))).toBe(true);
  });

  it("gives the same archive for the same files", () => {
    const dir = builtMod();
    execFileSync(process.execPath, [BIN, "package", "--out", join(dir, "a")], {
      cwd: dir,
    });
    execFileSync(process.execPath, [BIN, "package", "--out", join(dir, "b")], {
      cwd: dir,
    });
    expect(
      readFileSync(join(dir, "a", "GonogoXUplink.zip")).equals(
        readFileSync(join(dir, "b", "GonogoXUplink.zip")),
      ),
    ).toBe(true);
  });

  it("refuses to zip a mod that was not built", () => {
    const dir = uplinkDir({
      gamedata: "GonogoXUplink",
      dll: "GonogoXUplink.dll",
    });
    const { code, out } = runBin(["package"], dir);
    expect(code).toBe(1);
    expect(out).toContain("build the mod in Release first");
  });
});

describe("uplink-tools release", () => {
  it("refuses a client URL that is still the scaffold's placeholder, before building anything", () => {
    const dir = uplinkDir({
      gamedata: "GonogoXUplink",
      dll: "GonogoXUplink.dll",
      client: {
        url: "https://cdn.jsdelivr.net/gh/you/x@releases/releases/x/0.0.1/x.client.js",
      },
    });
    writeFileSync(join(dir, "mod", "GonogoXUplink.csproj"), "<Project />");

    const { code, out } = runBin(["release"], dir);

    expect(code).toBe(1);
    expect(out).toContain("still the placeholder");
    expect(existsSync(join(dir, "mod", "Provenance.g.cs"))).toBe(false);
  });
});

describe("uplink-tools codegen", () => {
  it("has nothing to do for an Uplink with no contract slice of its own, and says so", () => {
    const dir = uplinkDir();
    const { code, out } = runBin(["codegen"], dir);
    expect(code).toBe(0);
    expect(out).toContain("nothing to generate");
  });

  it("refuses a --contract directory that does not hold the twin and its props", () => {
    const dir = uplinkDir({
      codegen: {
        assembly: "Gonogo.X.Contract",
        configurationMethod: "Gonogo.X.RtConfig.Configure",
        emits: {},
      },
    });
    mkdirSync(join(dir, "mod-contract-codegen"));
    writeFileSync(
      join(dir, "mod-contract-codegen", "Gonogo.X.Contract.Codegen.csproj"),
      "<Project />",
    );
    const { code, out } = runBin(["codegen", "--contract", workdir()], dir);
    expect(code).toBe(1);
    expect(out).toContain("CodegenTwin.props");
  });
});

describe("uplink-tools new, run with no terminal", () => {
  it("asks nothing, exits 2 and names every missing flag, through the real bin", () => {
    const dir = workdir();
    // stdin is a pipe here, which is how an agent or a script runs it.
    const { code, out } = runBin(["new", "fresh", "--name", "Fresh"], dir);

    expect(code).toBe(2);
    expect(out).toContain("stdin is not a terminal");
    for (const flag of ["--author <name>", "--topics own | core", "--yes"]) {
      expect(out).toContain(flag);
    }
    expect(existsSync(join(dir, "uplink.json"))).toBe(false);
  });

  it("lists every question as a flag in its help", () => {
    const { out } = runBin(["new", "--help"]);
    for (const flag of [
      "--name <name>",
      "--author <name>",
      "--repo <owner>/<name> | --no-repo",
      "--topics own | core",
      "--workflows | --no-workflows",
      "--ksp <path> | --no-ksp",
      "--yes",
    ]) {
      expect(out).toContain(flag);
    }
  });
});

describe("the top-level help", () => {
  it("names every command and how to run one without an install", () => {
    const { code, out } = runBin(["--help"]);
    expect(code).toBe(0);
    for (const verb of [
      "new",
      "codegen",
      "bundle",
      "bake",
      "package",
      "release",
      "page",
      "render",
      "docs",
    ]) {
      expect(out).toMatch(new RegExp(`^  ${verb} `, "m"));
    }
    expect(out).toContain("npx @ksp-gonogo/uplink-tools <command>");
  });

  it("refuses a command it does not have", () => {
    const { code, out } = runBin(["publish"]);
    expect(code).toBe(1);
    expect(out).toContain('unknown command "publish"');
  });
});

/**
 * The top-level help says "Run a command with --help for its options", so every
 * command must print its own options rather than run, and must not reach its
 * flag parser with `--help` as an unknown flag.
 */
describe("every command answers --help", () => {
  for (const verb of [
    "new",
    "codegen",
    "bundle",
    "bake",
    "package",
    "release",
    "page",
    "render",
    "docs",
  ]) {
    it(`${verb} prints its own options rather than running`, () => {
      const { code, out } = runBin([verb, "--help"]);
      expect(code).toBe(0);
      expect(out).toContain(`uplink-tools ${verb}`);
      expect(out).toContain("--");
    });
  }
});

/**
 * A flag that belongs to another command is the likeliest typo there is, and a
 * command that ignored it would run and quietly do something else.
 */
describe("every command refuses a flag it does not read", () => {
  const cases: ReadonlyArray<[string, string[]]> = [
    ["new", ["new", "fresh", "--scene", "x"]],
    ["bundle", ["bundle", "--check"]],
    ["bake", ["bake", "--watch"]],
    ["codegen", ["codegen", "--watch"]],
    ["package", ["package", "--check"]],
    ["release", ["release", "--watch"]],
    ["page", ["page", "--watch"]],
    ["render", ["render", "--check"]],
    ["docs", ["docs", "--scene", "x"]],
  ];
  for (const [verb, args] of cases) {
    it(verb, () => {
      const dir = workdir();
      const { code, out } = runBin(args, dir);
      expect(code).toBe(1);
      expect(out).toMatch(/is not an option of|only applies to/);
      expect(out).toContain(`uplink-tools ${verb}`);
    });
  }
});

/**
 * `bundle --watch` keeps one esbuild context alive and reports each outcome in
 * `watch-status.json` beside the bundle, which is what the app's dev server
 * reads to say "waiting", "built" or "failed" without parsing a log.
 */
describe("uplink-tools bundle", () => {
  it("writes a sidecar that states the extension API and the contract, and no package's version to be compared", () => {
    const dir = workdir();
    writeFileSync(
      join(dir, "uplink.json"),
      JSON.stringify({
        id: "fixture",
        name: "Fixture",
        minAppVersion: "0.0.0",
      }),
    );
    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify({ name: "fixture-client", version: "1.2.3" }),
    );
    mkdirSync(join(dir, "src"));
    writeFileSync(join(dir, "src", "index.ts"), "export const marker = 1;\n");
    // A ui-kit installed above the client, at a version the sidecar must not repeat: a release moves it with no change to what the client uses.
    const kit = join(dir, "node_modules", "@ksp-gonogo", "ui-kit");
    mkdirSync(kit, { recursive: true });
    writeFileSync(
      join(kit, "package.json"),
      JSON.stringify({ name: "@ksp-gonogo/ui-kit", version: "7.0.0-rc.3" }),
    );

    execFileSync(process.execPath, [BIN, "bundle"], {
      cwd: dir,
      stdio: "pipe",
    });

    const sidecar: unknown = JSON.parse(
      readFileSync(join(dir, "dist", "fixture", "gonogo-uplink.json"), "utf8"),
    );
    expect(sidecar).toMatchObject({
      apiVersion: expect.stringMatching(/^\d+\.\d+\.\d+$/),
      contractMajor: expect.any(Number),
      contractMinor: expect.any(Number),
    });
    expect(sidecar).not.toHaveProperty("uiKitVersion");
  });
});

describe("uplink-tools bundle --watch", () => {
  const children: Array<ReturnType<typeof spawn>> = [];
  afterEach(() => {
    for (const child of children.splice(0)) child.kill("SIGKILL");
  });

  const client = (source: string) => {
    const dir = workdir();
    writeFileSync(
      join(dir, "uplink.json"),
      JSON.stringify({
        id: "fixture",
        name: "Fixture",
        author: "someone",
        repo: "https://example.invalid/fixture",
        minAppVersion: "0.0.0",
      }),
    );
    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify({ name: "fixture-client", version: "1.2.3" }),
    );
    mkdirSync(join(dir, "src"));
    writeFileSync(join(dir, "src", "index.ts"), source);
    return dir;
  };

  const statusPath = (dir: string) =>
    join(dir, "dist", "fixture", "watch-status.json");
  const bundlePath = (dir: string) =>
    join(dir, "dist", "fixture", "fixture.client.js");
  const stringField = (record: object, key: string): string | null => {
    const value: unknown = Reflect.get(record, key);
    return typeof value === "string" ? value : null;
  };
  const readStatus = (dir: string) => {
    try {
      const parsed: unknown = JSON.parse(readFileSync(statusPath(dir), "utf8"));
      if (typeof parsed !== "object" || parsed === null) return undefined;
      return {
        state: stringField(parsed, "state") ?? "",
        builtAt: stringField(parsed, "builtAt"),
        integrity: stringField(parsed, "integrity"),
        error: stringField(parsed, "error"),
      };
    } catch {
      return undefined;
    }
  };
  const until = async <Reading>(
    read: () => Reading | undefined,
  ): Promise<Reading> => {
    const deadline = Date.now() + 15_000;
    for (;;) {
      const value = read();
      if (value !== undefined) return value;
      if (Date.now() > deadline) throw new Error("timed out waiting");
      await new Promise((r) => setTimeout(r, 50));
    }
  };

  const watch = (dir: string) => {
    const child = spawn(
      process.execPath,
      [BIN, "bundle", "--watch", "--client", dir],
      {
        stdio: "pipe",
      },
    );
    children.push(child);
    return child;
  };

  it("rebuilds on an edit, and says failed with the old bundle intact when the source breaks", async () => {
    const dir = client("export const marker = 'one';\n");
    const child = watch(dir);

    const first = await until(() => {
      const status = readStatus(dir);
      return status?.state === "built" ? status : undefined;
    });
    expect(first.integrity).toMatch(/^sha256-[0-9a-f]{64}$/);
    const firstBytes = readFileSync(bundlePath(dir), "utf8");
    expect(firstBytes).toContain("one");

    writeFileSync(
      join(dir, "src", "index.ts"),
      "export const marker = 'two';\n",
    );
    const second = await until(() => {
      const status = readStatus(dir);
      return status?.state === "built" && status.integrity !== first.integrity
        ? status
        : undefined;
    });
    const secondBytes = readFileSync(bundlePath(dir), "utf8");
    expect(secondBytes).toContain("two");
    expect(readFileSync(`${bundlePath(dir)}.sha256`, "utf8").trim()).toBe(
      second.integrity,
    );
    expect(
      JSON.parse(
        readFileSync(
          join(dir, "dist", "fixture", "gonogo-uplink.json"),
          "utf8",
        ),
      ).integrity,
    ).toBe(second.integrity);

    writeFileSync(join(dir, "src", "index.ts"), "export const marker = ;\n");
    const failed = await until(() => {
      const status = readStatus(dir);
      return status?.state === "failed" ? status : undefined;
    });
    expect(failed.error).toBeTruthy();
    expect(failed.error).not.toContain("\n");
    expect(readFileSync(bundlePath(dir), "utf8")).toBe(secondBytes);

    const exited = new Promise<number | null>((resolveExit) =>
      child.once("exit", (code) => resolveExit(code)),
    );
    child.kill("SIGINT");
    expect(await exited).toBe(0);
  }, 30_000);

  it("reads waiting before the first build has finished", async () => {
    const dir = client("export const marker = 'one';\n");
    mkdirSync(join(dir, "dist", "fixture"), { recursive: true });
    watch(dir);
    const status = await until(() => readStatus(dir));
    expect(["waiting", "built"]).toContain(status.state);
    expect(existsSync(statusPath(dir))).toBe(true);
  }, 30_000);
});
