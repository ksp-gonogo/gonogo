import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { BumpError, bumpDependencies, type Runner } from "./bump";
import { recordedHttp } from "./recorded";
import { uplinkOn } from "./uplink-on";

const base = (dir: string) => ({
  uplinkDir: dir,
  names: [] as string[],
  skip: [] as never[],
  logDir: join(dir, "logs"),
  self: ["uplink-tools"],
});

const passing: Runner = () => ({ status: 0, output: "ok" });

const ex1 = {
  id: "ex1",
  mod: {
    name: "Example-1",
    tier: "ckan",
    ckan: "Example-1",
    builtAgainst: "4.7.0.0",
    channels: [{ ckan: "Example-1" }, { github: "example-org/example-mod" }],
  },
};

describe("bumpDependencies", () => {
  it("does nothing, and says green, when nothing is behind", async () => {
    const dir = uplinkOn({
      ...ex1,
      mod: { ...ex1.mod, builtAgainst: "4.8.1.0" },
    });
    const { result, exit } = await bumpDependencies({
      ...base(dir),
      http: recordedHttp(),
      run: passing,
    });
    expect(exit).toBe(0);
    expect(result.bumps).toEqual([]);
  });

  it("moves the pin and writes CKAN's spelling, and calls a reflection-bound mod unverified", async () => {
    const dir = uplinkOn(ex1);
    const commands: string[] = [];
    const run: Runner = (command, args) => {
      commands.push([command, ...args].join(" "));
      return { status: 0, output: "ok" };
    };
    const { result, exit } = await bumpDependencies({
      ...base(dir),
      http: recordedHttp(),
      run,
    });
    const uplink = JSON.parse(readFileSync(join(dir, "uplink.json"), "utf8"));
    expect(uplink.mod.builtAgainst).toBe("4.8.1.0");
    expect(uplink.mod.ckanVersion).toBe("v4.8.1.0");
    expect(result.bumps).toEqual([
      expect.objectContaining({
        name: "Example-1",
        from: "4.7.0.0",
        to: "4.8.1.0",
        ckanMinVersion: "v4.8.1.0",
      }),
    ]);
    expect(result.changed).toEqual(["uplink.json"]);
    expect(result.exercised["Example-1"]).toBe("nothing ran against 4.8.1.0");
    expect(result.verdict).toBe("unverified");
    expect(exit).toBe(3);
    expect(commands[0]).toBe("uplink-tools page");
    expect(commands).toContain("uplink-tools check");
  });

  it("is red when a check fails, with the excerpt and a log", async () => {
    const dir = uplinkOn(ex1);
    const run: Runner = (_command, args) =>
      args[0] === "check"
        ? { status: 1, output: "line one\nbroken thing" }
        : { status: 0, output: "ok" };
    const { result, exit } = await bumpDependencies({
      ...base(dir),
      http: recordedHttp(),
      run,
    });
    const failed = result.checks.find((c) => c.name === "check");
    expect(failed).toMatchObject({
      status: "fail",
      excerpt: "line one\nbroken thing",
    });
    expect(existsSync(failed?.log ?? "")).toBe(true);
    expect(result.verdict).toBe("red");
    expect(exit).toBe(1);
  });

  it("restores every file when the page cannot be written", async () => {
    const dir = uplinkOn(ex1);
    const before = readFileSync(join(dir, "uplink.json"), "utf8");
    const run: Runner = () => ({ status: 1, output: "no" });
    await expect(
      bumpDependencies({ ...base(dir), http: recordedHttp(), run }),
    ).rejects.toThrow("page failed");
    expect(readFileSync(join(dir, "uplink.json"), "utf8")).toBe(before);
  });

  it("moves the packages that travel with the mod and is green when types and tests ran", async () => {
    const dir = uplinkOn(
      {
        id: "kc",
        mod: {
          name: "Kc",
          builtAgainst: "1.0.0",
          channels: [{ github: "example-org/example-mod" }],
          packages: ["@ksp-gonogo/sitrep-sdk"],
        },
      },
      {
        scripts: { typecheck: "tsc", test: "vitest" },
        dependencies: { "@ksp-gonogo/sitrep-sdk": "1.0.0" },
      },
    );
    const { result, exit } = await bumpDependencies({
      ...base(dir),
      http: recordedHttp(),
      run: passing,
    });
    const manifest = JSON.parse(
      readFileSync(join(dir, "client", "package.json"), "utf8"),
    );
    expect(manifest.dependencies["@ksp-gonogo/sitrep-sdk"]).toBe("4.8.1.0");
    expect(result.changed).toEqual(["uplink.json", "client/package.json"]);
    expect(result.exercised.Kc).toBe("types and tests");
    expect(result.verdict).toBe("green");
    expect(exit).toBe(0);
  });

  it("refuses gonogo's own packages and a prerelease target", async () => {
    const dir = uplinkOn(ex1, {
      devDependencies: { "@ksp-gonogo/sitrep-sdk": "0.0.1" },
    });
    await expect(
      bumpDependencies({
        ...base(dir),
        names: ["@ksp-gonogo/sitrep-sdk"],
        http: recordedHttp(),
        run: passing,
      }),
    ).rejects.toThrow(BumpError);
    await expect(
      bumpDependencies({
        ...base(dir),
        names: ["Example-1"],
        to: "4.9.0-rc.1",
        http: recordedHttp(),
        run: passing,
      }),
    ).rejects.toThrow("prerelease");
  });

  it("downloads the release archive for a compile-bound mod and builds against a copy of GameData", async () => {
    const dir = uplinkOn({
      ...ex1,
      mod: { ...ex1.mod, assembly: "Example-1/Plugins/Example-1.dll" },
    });
    mkdirSync(join(dir, "mod"));
    writeFileSync(
      join(dir, "mod", "Ex1.csproj"),
      "<Project><HintPath>$(KspGameData)/Example-1/Plugins/Example-1.dll</HintPath></Project>",
    );
    const gamedata = join(dir, "GameData");
    mkdirSync(gamedata);
    writeFileSync(join(gamedata, "keep.txt"), "x");
    const http = recordedHttp(undefined, {
      "https://github.com/example-org/example-mod/releases/download/v4.8.1.0/Example-1-v4.8.1.0.zip":
        new Uint8Array([1]),
    });
    const commands: string[] = [];
    const run: Runner = (command, args) => {
      commands.push([command, ...args].join(" "));
      return { status: 0, output: "ok" };
    };
    const { result } = await bumpDependencies({
      ...base(dir),
      gamedata,
      http,
      run,
    });
    expect(result.reference["Example-1"]).toContain(
      "downloaded https://github.com/example-org/example-mod",
    );
    expect(commands.some((c) => c.startsWith("unzip"))).toBe(true);
    expect(commands.find((c) => c.startsWith("dotnet build"))).toContain(
      "-p:KspGameData=",
    );
    expect(result.exercised["Example-1"]).toBe("compiled");
    expect(existsSync(join(gamedata, "keep.txt"))).toBe(true);
  });

  it("hands the downloaded release of a reflection-bound mod to --reference-out", async () => {
    const dir = uplinkOn(ex1);
    const out = join(dir, "reference");
    const http = recordedHttp(undefined, {
      "https://github.com/example-org/example-mod/releases/download/v4.8.1.0/Example-1-v4.8.1.0.zip":
        new Uint8Array([1]),
    });
    const run: Runner = (command, args) => {
      if (command === "unzip") {
        const into = args[args.indexOf("-d") + 1];
        mkdirSync(join(into, "GameData", "Example-1", "Plugins"), {
          recursive: true,
        });
        writeFileSync(
          join(into, "GameData", "Example-1", "Plugins", "Example-1.dll"),
          "dll",
        );
      }
      return { status: 0, output: "ok" };
    };
    const { result } = await bumpDependencies({
      ...base(dir),
      referenceOut: out,
      http,
      run,
    });
    expect(
      readFileSync(join(out, "Example-1", "Plugins", "Example-1.dll"), "utf8"),
    ).toBe("dll");
    expect(result.reference["Example-1"]).toContain("downloaded");
  });
});
