// @vitest-environment node
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  type CommittedPage,
  compareCommittedPage,
  PICTURES_ARE_CI_NOTE,
  picturesComparedHere,
  run,
} from "./cli";
import {
  type AssetShape,
  SHAPE_RECORD_FILE,
  SHAPE_RECORD_VERSION,
} from "./shape";

const temporaries: string[] = [];

afterEach(() => {
  vi.restoreAllMocks();
  for (const dir of temporaries.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

async function refusal(argv: string[]): Promise<string> {
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  const code = await run(argv);
  expect(code).toBe(1);
  return error.mock.calls.map((call) => String(call[0])).join("\n");
}

describe("docs --no-assets", () => {
  it("refuses to combine with --check, which writes nothing to leave out", async () => {
    expect(await refusal(["docs", "--no-assets", "--check"])).toMatch(
      /--no-assets and --check do not combine/,
    );
  });

  it("refuses render, which has no prose to regenerate", async () => {
    expect(await refusal(["render", "--no-assets"])).toMatch(
      /--no-assets only applies to docs/,
    );
  });
});

describe("where docs --check compares pictures", () => {
  it("is CI, on GitHub Actions or any CI flag", () => {
    expect(picturesComparedHere({ GITHUB_ACTIONS: "true" })).toBe(true);
    expect(picturesComparedHere({ CI: "true" })).toBe(true);
    expect(picturesComparedHere({ CI: "1" })).toBe(true);
  });

  it("is nowhere else, whatever the operating system", () => {
    expect(picturesComparedHere({})).toBe(false);
    expect(picturesComparedHere({ CI: "" })).toBe(false);
    expect(picturesComparedHere({ CI: "false" })).toBe(false);
    expect(picturesComparedHere({ CI: "0" })).toBe(false);
  });
});

describe("the committed page, with and without pictures", () => {
  const shape = (hash: string): AssetShape => ({
    hash,
    elements: 3,
    text: "abcd1234",
  });

  function page(
    pictures: boolean,
    committed: { readme: string; assets: string[] },
  ): CommittedPage {
    const dir = mkdtempSync(join(tmpdir(), "gonogo-page-"));
    temporaries.push(dir);
    const committedAssets = join(dir, "committed");
    const generatedAssets = join(dir, "generated");
    mkdirSync(committedAssets);
    mkdirSync(generatedAssets);

    writeFileSync(join(dir, "README.md"), committed.readme);
    writeFileSync(join(dir, "gonogo-uplink.json"), "{}\n");
    for (const name of committed.assets) {
      writeFileSync(join(committedAssets, name), "a picture");
    }
    writeFileSync(join(generatedAssets, "a--default.png"), "a picture");
    writeFileSync(
      join(committedAssets, SHAPE_RECORD_FILE),
      JSON.stringify({
        version: SHAPE_RECORD_VERSION,
        engine: "chromium",
        assets: { "a--default.png": shape("rendered-on-the-runner") },
      }),
    );

    return {
      readmePath: join(dir, "README.md"),
      readme: "generated\n",
      manifestPath: join(dir, "gonogo-uplink.json"),
      manifestJson: "{}\n",
      committedAssets,
      generatedAssets,
      shapes: new Map([["a--default.png", shape("rendered-here")]]),
      engine: "chromium",
      pictures,
    };
  }

  const current = { readme: "generated\n", assets: ["a--default.png"] };

  it("on CI, a shape the runner did not record is a difference", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const { differences } = await compareCommittedPage(page(true, current));

    expect(differences).toHaveLength(1);
    expect(differences[0]).toContain(
      "a--default.png: the committed picture is not what this code renders",
    );
    expect(log.mock.calls.flat().join("\n")).not.toContain(
      PICTURES_ARE_CI_NOTE,
    );
  });

  it("locally, the same shape is not compared, and the run says so once", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const { differences, wholePage } = await compareCommittedPage(
      page(false, current),
    );

    expect(differences).toEqual([]);
    expect(wholePage).toBeUndefined();
    const lines = log.mock.calls.flat().join("\n");
    expect(lines.split(PICTURES_ARE_CI_NOTE)).toHaveLength(2);
  });

  it("locally, the README and the asset names are still compared", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const { differences } = await compareCommittedPage(
      page(false, { readme: "committed\n", assets: ["gone--default.png"] }),
    );

    const all = differences.join("\n");
    expect(all).toContain("README.md differs at line 1");
    expect(all).toContain("missing asset a--default.png");
    expect(all).toContain("stale asset gone--default.png");
    expect(all).not.toContain("the committed picture is not what");
  });
});
