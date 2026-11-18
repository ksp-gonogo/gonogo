import { execFileSync } from "node:child_process";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { packageMod } from "./package";
import { modOnlyFixture, put, scratch } from "./uplink-fixture";

afterEach(() => {
  for (const dir of scratch.splice(0))
    rmSync(dir, { recursive: true, force: true });
});

/** An Uplink with a built plugin, as `package` finds one after a Release build. */
function builtUplink(): string {
  const dir = modOnlyFixture();
  put(
    dir,
    "uplink.json",
    `${JSON.stringify({ id: "demo", gamedata: "GonogoDemoUplink", dll: "GonogoDemoUplink.dll" })}\n`,
  );
  put(dir, "mod/bin/Release/GonogoDemoUplink.dll", "dll");
  return dir;
}

const zipPaths = (zip: string) =>
  execFileSync("unzip", ["-Z1", zip], { encoding: "utf8" })
    .split("\n")
    .filter(Boolean)
    .sort();

describe("package", () => {
  it("puts the mod folder's ModuleManager patches beside the plugin, with its licence and notices", () => {
    const dir = builtUplink();
    put(dir, "mod/LICENSE", "GPL");
    put(dir, "mod/NOTICE-KOS.txt", "notice");
    put(dir, "mod/GonogoDemoUplink.cfg", "@PART[*] { }\n");
    put(dir, "mod/Other.CFG", "@PART[*] { }\n");
    put(dir, "mod/Notes.md", "not shipped");
    put(dir, "mod/Thing.cs", "not shipped");

    const result = packageMod(dir, join(dir, "dist"));

    expect(zipPaths(result.zip)).toEqual([
      "GameData/GonogoDemoUplink/GonogoDemoUplink.cfg",
      "GameData/GonogoDemoUplink/LICENSE",
      "GameData/GonogoDemoUplink/NOTICE-KOS.txt",
      "GameData/GonogoDemoUplink/Other.CFG",
      "GameData/GonogoDemoUplink/Plugins/GonogoDemoUplink.dll",
    ]);
  });

  it("holds the plugin alone when the mod folder has nothing else to ship", () => {
    const dir = builtUplink();
    const result = packageMod(dir, join(dir, "dist"));
    expect(zipPaths(result.zip)).toEqual([
      "GameData/GonogoDemoUplink/Plugins/GonogoDemoUplink.dll",
    ]);
  });
});
