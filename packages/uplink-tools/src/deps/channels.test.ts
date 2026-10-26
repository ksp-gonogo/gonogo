import { describe, expect, it } from "vitest";
import {
  ckanSpelling,
  newestAnswer,
  parseChannels,
  readChannel,
  versionOfTag,
} from "./channels";
import { recordedHttp } from "./recorded";

describe("parseChannels", () => {
  it("reads every kind", () => {
    const { channels, problems } = parseChannels(
      [
        { ckan: "Camera" },
        { github: "ksp-gonogo/camera" },
        { githubTags: "o/r", pattern: "^(?<order>\\d{10})-" },
        { spacedock: 4366 },
        { npm: "@example/pkg", distTag: "latest" },
      ],
      "mod.channels",
    );
    expect(problems).toEqual([]);
    expect(channels).toHaveLength(5);
  });

  it("says what is wrong with an entry", () => {
    const { problems } = parseChannels(
      [
        {},
        { ckan: "A", github: "o/r" },
        { github: "nope" },
        { githubTags: "o/r" },
        { spacedock: "1" },
      ],
      "mod.channels",
    );
    expect(problems).toHaveLength(5);
    expect(problems[0]).toContain("mod.channels[0]");
    expect(problems[1]).toContain('"ckan" and "github"');
    expect(problems[3]).toContain("pattern");
  });

  it("reads an absent list as no channels", () => {
    expect(parseChannels(undefined, "x")).toEqual({
      channels: [],
      problems: [],
    });
  });
});

describe("versionOfTag", () => {
  it("finds the dotted number in a tag", () => {
    expect(versionOfTag("v0.16.1.2_Marangoni")).toBe("0.16.1.2");
    expect(versionOfTag("v4.8.1.0")).toBe("4.8.1.0");
  });
  it("uses a version group when the channel names a pattern", () => {
    expect(versionOfTag("release-12-x", "^release-(?<version>\\d+)")).toBe(
      "12",
    );
  });
});

describe("readChannel on recorded responses", () => {
  const http = recordedHttp();

  it("reads the release GitHub marks latest", async () => {
    const result = await readChannel(
      { github: "example-org/example-mod" },
      http,
    );
    expect(result.answer).toMatchObject({
      version: "4.8.1.0",
      download:
        "https://github.com/example-org/example-mod/releases/download/v4.8.1.0/Example-1-v4.8.1.0.zip",
    });
  });

  it("reads the newest stable CKAN entry in CKAN's spelling", async () => {
    const result = await readChannel({ ckan: "Example-1" }, http);
    expect(result.answer).toMatchObject({
      version: "4.8.1.0",
      ckanVersion: "v4.8.1.0",
    });
  });

  it("reads the first SpaceDock version", async () => {
    const result = await readChannel({ spacedock: 1685 }, http);
    expect(result.answer?.version).toBe("2.4.1.4");
  });

  it("reads the highest numbered tag, keeping its whole name", async () => {
    const result = await readChannel(
      {
        githubTags: "tag-org/TagMod",
        pattern: "^(?<order>\\d{10})-",
      },
      http,
    );
    expect(result.answer).toMatchObject({
      version: "2026101016-Lichnerowicz",
      order: "2026101016",
    });
  });

  it("follows the npm dist-tag, never the highest version", async () => {
    const latest = await readChannel({ npm: "@ksp-gonogo/sitrep-sdk" }, http);
    const rc = await readChannel(
      { npm: "@ksp-gonogo/sitrep-sdk", distTag: "rc" },
      http,
    );
    expect(latest.answer?.version).toBe("0.0.1");
    expect(rc.answer?.version).toBe("1.0.0-rc.45");
  });

  it("refuses a dist-tag that points at a deprecated version", async () => {
    const deprecated = recordedHttp({
      "https://registry.npmjs.org/p": {
        "dist-tags": { latest: "2.0.0-rc.23" },
        versions: { "2.0.0-rc.23": { deprecated: "no" } },
      },
    });
    const result = await readChannel({ npm: "p" }, deprecated);
    expect(result.error).toContain("deprecated");
  });

  it("sets aside a prerelease and reports a failed read as an error", async () => {
    const prerelease = recordedHttp({
      "https://api.github.com/repos/o/r/releases/latest": {
        tag_name: "dev-2.16.0.0-1234",
        prerelease: true,
      },
    });
    expect((await readChannel({ github: "o/r" }, prerelease)).error).toContain(
      "prerelease",
    );
    const down = await readChannel({ github: "o/missing" }, prerelease);
    expect(down.error).toContain("404");
    expect(down.answer).toBeUndefined();
  });
});

describe("ckanSpelling", () => {
  it("finds how CKAN lists the pinned release", async () => {
    expect(await ckanSpelling("Example-1", "4.8.0.0", recordedHttp())).toBe(
      "v4.8.0.0",
    );
  });
  it("is undefined for a release CKAN does not list", async () => {
    expect(
      await ckanSpelling("Example-1", "9.9.9", recordedHttp()),
    ).toBeUndefined();
  });
});

describe("newestAnswer", () => {
  it("keeps the first channel on a tie and the highest otherwise", () => {
    const a = { channel: "ckan X", version: "1.0" };
    const b = { channel: "github o/r", version: "1.0.0" };
    const c = { channel: "npm p latest", version: "1.1" };
    expect(newestAnswer([a, b])).toBe(a);
    expect(newestAnswer([a, b, c])).toBe(c);
  });
});
