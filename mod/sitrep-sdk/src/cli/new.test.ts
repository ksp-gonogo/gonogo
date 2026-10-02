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
import { afterEach, describe, expect, it, vi } from "vitest";
import { newUplink, renderSeed, validateUplinkId } from "./new";

const scratch: string[] = [];
const workdir = () => {
  const dir = mkdtempSync(join(tmpdir(), "gonogo-new-"));
  scratch.push(dir);
  return dir;
};

afterEach(() => {
  vi.restoreAllMocks();
  for (const dir of scratch.splice(0))
    rmSync(dir, { recursive: true, force: true });
});

const seed = () =>
  renderSeed({
    id: "widgets",
    name: "Widgets",
    author: "me",
    repo: "https://elsewhere.test/r",
    clientUrl: "https://elsewhere.test/widgets.js",
    dependencies: {},
    devDependencies: {},
  });

describe("gonogo-uplink new", () => {
  it("templates no generated file", () => {
    for (const path of seed().keys()) {
      expect(path).not.toMatch(/__generated__|\.g\.cs$|README\.md$|renders\//);
    }
  });

  it("derives every name from the id", () => {
    const files = seed();
    const declared = JSON.parse(files.get("uplink.json") ?? "");
    expect(declared.gamedata).toBe("GonogoWidgetsUplink");
    expect(declared.codegen.configurationMethod).toBe(
      "GonogoWidgetsUplink.WidgetsRtConfig.Configure",
    );
    expect(Object.keys(declared.codegen.emits)).toEqual([
      "SITREP_WIDGETS_TOPICMAP_OUT",
      "SITREP_WIDGETS_UNITMAP_OUT",
      "SITREP_WIDGETS_UNITJSON_OUT",
    ]);
    expect(files.get("mod/WidgetsUplink.cs")).toContain(
      'HeartbeatTopic = "widgets.heartbeat"',
    );
    expect(files.has("mod-tests/GonogoWidgetsUplink.Tests.csproj")).toBe(true);
    // The contract's C# attribute and the client's declare-module block must name the same topic.
    expect(files.get("mod-contract/WidgetsPayloads.cs")).toContain(
      '[SitrepTopic("widgets.heartbeat")]',
    );
    expect(files.get("client/src/topics.ts")).toContain(
      '"widgets.heartbeat": WidgetsHeartbeat;',
    );
    for (const [path, content] of files) {
      if (path.endsWith(".json"))
        expect(() => JSON.parse(content)).not.toThrow();
      expect(content).not.toContain("example");
    }
  });

  it("refuses an id that cannot name a namespace", () => {
    expect(validateUplinkId("my-uplink")).toMatch(/not a usable/);
    expect(validateUplinkId("1abc")).toMatch(/not a usable/);
    expect(validateUplinkId("ok2")).toBeUndefined();
  });

  it("writes the seed, inherits a sibling's pins and never overwrites", () => {
    const root = workdir();
    const uplinks = join(root, "uplinks");
    mkdirSync(join(uplinks, "sib", "client"), { recursive: true });
    writeFileSync(
      join(uplinks, "sib", "uplink.json"),
      JSON.stringify({
        id: "sib",
        author: "a",
        repo: "https://r",
        client: { url: "https://cdn/sib/0.0.1/sib.client.js" },
      }),
    );
    writeFileSync(
      join(uplinks, "sib", "client", "package.json"),
      JSON.stringify({
        dependencies: { "@ksp-gonogo/ui-kit": "file:../../../vendor/kit.tgz" },
        devDependencies: {},
      }),
    );
    vi.spyOn(console, "log").mockImplementation(() => {});

    newUplink(["fresh", "--dir", uplinks]);

    const pkg = JSON.parse(
      readFileSync(join(uplinks, "fresh", "client", "package.json"), "utf8"),
    );
    expect(pkg.dependencies["@ksp-gonogo/ui-kit"]).toBe(
      "file:../../../vendor/kit.tgz",
    );
    const declared = JSON.parse(
      readFileSync(join(uplinks, "fresh", "uplink.json"), "utf8"),
    );
    expect(declared.client.url).toBe("https://cdn/fresh/0.0.1/fresh.client.js");
    expect(existsSync(join(uplinks, "fresh", "mod", "FreshUplink.cs"))).toBe(
      true,
    );
    expect(() => newUplink(["fresh", "--dir", uplinks])).toThrow(
      /already exists/,
    );
  });
});
