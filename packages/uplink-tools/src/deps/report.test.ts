import { describe, expect, it } from "vitest";
import { recordedHttp } from "./recorded";
import { buildReport, reportExit, reportJson, reportTable } from "./report";
import { uplinkOn } from "./uplink-on";

const ex1 = (
  builtAgainst: string,
  channels: unknown = [
    { ckan: "Example-1" },
    { github: "example-org/example-mod" },
  ],
) => ({
  id: "ex1",
  mod: {
    name: "Example-1",
    tier: "ckan",
    ckan: "Example-1",
    builtAgainst,
    channels,
  },
});

describe("buildReport", () => {
  it("reads a pin behind two channels that agree", async () => {
    const report = await buildReport({
      uplinkDir: uplinkOn(ex1("4.7.0.0")),
      http: recordedHttp(),
    });
    expect(report.dependencies).toHaveLength(1);
    expect(report.dependencies[0]).toMatchObject({
      name: "Example-1",
      pinned: "4.7.0.0",
      newest: "4.8.1.0",
      channel: "ckan Example-1",
      binds: "reflection",
      state: "behind",
    });
    expect(report.dependencies[0].channels.map((c) => c.channel)).toEqual([
      "ckan Example-1",
      "github example-org/example-mod",
    ]);
    expect(reportExit(report)).toBe(10);
  });

  it("is current when the pin is the newest, whatever the trailing zeros", async () => {
    const report = await buildReport({
      uplinkDir: uplinkOn(ex1("4.8.1")),
      http: recordedHttp(),
    });
    expect(report.dependencies[0].state).toBe("current");
    expect(reportExit(report)).toBe(0);
  });

  it("is ahead when the pin is newer than every channel", async () => {
    const report = await buildReport({
      uplinkDir: uplinkOn(ex1("4.9.0.0")),
      http: recordedHttp(),
    });
    expect(report.dependencies[0].state).toBe("ahead");
  });

  it("reads a pinned prerelease as behind its own release", async () => {
    const report = await buildReport({
      uplinkDir: uplinkOn(ex1("4.8.1.0-rc.2")),
      http: recordedHttp(),
    });
    expect(report.dependencies[0].state).toBe("behind");
  });

  it("orders a tag channel by its number", async () => {
    const dir = uplinkOn({
      id: "tagmod",
      mod: {
        name: "TagMod",
        tier: "manual",
        builtAgainst: "2026081218-Levi-Civita",
        channels: [
          {
            githubTags: "tag-org/TagMod",
            pattern: "^(?<order>\\d{10})-",
          },
        ],
      },
    });
    const report = await buildReport({ uplinkDir: dir, http: recordedHttp() });
    expect(report.dependencies[0]).toMatchObject({
      state: "behind",
      newest: "2026101016-Lichnerowicz",
    });
  });

  it("says unwatched, never current, for a mod with no channels", async () => {
    const report = await buildReport({
      uplinkDir: uplinkOn(ex1("4.7.0.0", [])),
      http: recordedHttp({}),
    });
    expect(report.dependencies[0].state).toBe("unwatched");
    expect(reportExit(report)).toBe(0);
  });

  it("exits 2 when a channel cannot be read, even if another channel answered", async () => {
    const half = recordedHttp({
      "https://api.github.com/repos/example-org/example-mod/releases/latest": {
        tag_name: "v4.8.1.0",
        prerelease: false,
      },
    });
    const report = await buildReport({
      uplinkDir: uplinkOn(ex1("4.7.0.0")),
      http: half,
    });
    expect(report.dependencies[0].state).toBe("behind");
    expect(reportExit(report)).toBe(2);
    expect(reportTable(report)).toContain("ckan Example-1");
  });

  it("reports the packages that move with the mod through the mod's own row", async () => {
    const dir = uplinkOn(
      {
        id: "camera",
        mod: {
          name: "Camera",
          builtAgainst: "1.11.0-rc.10",
          channels: [{ github: "example-org/example-mod" }],
          packages: ["@ksp-gonogo/sitrep-sdk"],
        },
      },
      { dependencies: { "@ksp-gonogo/sitrep-sdk": "1.11.0-rc.10" } },
    );
    const report = await buildReport({ uplinkDir: dir, http: recordedHttp() });
    const mod = report.dependencies.find((d) => d.kind === "mod");
    expect(mod?.packages).toEqual(["@ksp-gonogo/sitrep-sdk"]);
    expect(mod?.channels.map((c) => c.channel)).toContain(
      "npm @ksp-gonogo/sitrep-sdk latest",
    );
  });

  it("reports gonogo's own packages and never counts them as behind", async () => {
    const dir = uplinkOn(ex1("4.8.1.0"), {
      dependencies: { "@ksp-gonogo/ui-kit": "file:../../vendor/ui-kit.tgz" },
      devDependencies: { "@ksp-gonogo/sitrep-sdk": "0.0.1" },
    });
    const report = await buildReport({
      uplinkDir: dir,
      http: recordedHttp(),
      gonogo: "rc",
    });
    const sdk = report.dependencies.find(
      (d) => d.name === "@ksp-gonogo/sitrep-sdk",
    );
    expect(sdk).toMatchObject({
      state: "behind",
      reportOnly: true,
      newest: "1.0.0-rc.45",
    });
    const kit = report.dependencies.find(
      (d) => d.name === "@ksp-gonogo/ui-kit",
    );
    expect(kit?.state).toBe("vendored");
  });

  it("refuses a malformed channel list with the sentence for it", async () => {
    await expect(
      buildReport({
        uplinkDir: uplinkOn(ex1("4.7.0.0", [{ nope: 1 }])),
        http: recordedHttp(),
      }),
    ).rejects.toThrow("mod.channels[0]");
  });
});

describe("reportJson", () => {
  it("names the schema and omits the internal answer", async () => {
    const report = await buildReport({
      uplinkDir: uplinkOn(ex1("4.7.0.0")),
      http: recordedHttp(),
    });
    const parsed = JSON.parse(reportJson(report));
    expect(parsed.schema).toBe("uplink-deps/1");
    expect(parsed.uplink).toBe("ex1");
    expect(parsed.dependencies[0].answer).toBeUndefined();
    expect(parsed.dependencies[0].url).toContain("CKAN-meta");
  });
});
