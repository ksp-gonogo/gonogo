import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/** The commands of `uplink-tools` that read `uplink.json`. */
const COMMANDS = [
  "bake",
  "bundle",
  "check",
  "codegen",
  "docs",
  "package",
  "page",
  "release",
];

const source = readFileSync(
  new URL("./uplink-manifest.ts", import.meta.url),
  "utf8",
);
const body =
  /export interface UplinkDeclaration \{([\s\S]*?)\n\}\n/.exec(source)?.[1] ??
  "";

/** Each top-level field of `UplinkDeclaration` with the `@readBy` of the comment above it. */
const fields = [
  ...body.matchAll(/\n {2}(\/\*\*(?:(?!\*\/)[\s\S])*?\*\/)\n {2}(\w+)\?:/g),
].map(([, comment, name]) => ({
  name,
  readBy: /@readBy (.+)/
    .exec(comment)?.[1]
    .split(",")
    .map((c) => c.trim()),
}));

describe("UplinkDeclaration @readBy", () => {
  it("finds every field", () => {
    expect(fields.map((f) => f.name)).toEqual(
      expect.arrayContaining([
        "id",
        "name",
        "author",
        "repo",
        "minAppVersion",
        "gamedata",
        "dll",
        "csharpNamespace",
        "mod",
        "codegen",
        "client",
      ]),
    );
  });

  it.each(fields)("$name names the commands that read it", ({ readBy }) => {
    expect(readBy).toBeDefined();
    expect(readBy?.every((c) => COMMANDS.includes(c))).toBe(true);
  });
});
