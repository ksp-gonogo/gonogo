// @vitest-environment node
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { compareRenderRecord } from "./cli";
import {
  RENDERED_FILES_RECORD,
  recordedRenders,
  recordRenders,
  removeRecordedRenders,
} from "./rendered-files";

const scratch: string[] = [];
afterEach(() => {
  for (const dir of scratch.splice(0))
    rmSync(dir, { recursive: true, force: true });
});
const folder = () => {
  const dir = mkdtempSync(join(tmpdir(), "uplink-renders-"));
  scratch.push(dir);
  return dir;
};

describe("the files a render run may delete", () => {
  it("never deletes a picture the tool did not write", async () => {
    const dir = folder();
    writeFileSync(join(dir, "logo.png"), "the author's");
    writeFileSync(join(dir, "demo.gif"), "the author's");
    writeFileSync(join(dir, "radar--default.png"), "ours");
    recordRenders(dir, ["radar--default.png"]);

    await removeRecordedRenders(dir);

    expect(existsSync(join(dir, "radar--default.png"))).toBe(false);
    expect(readFileSync(join(dir, "logo.png"), "utf8")).toBe("the author's");
    expect(existsSync(join(dir, "demo.gif"))).toBe(true);
  });

  it("deletes nothing in a folder no run has written to", async () => {
    const dir = folder();
    writeFileSync(join(dir, "a.png"), "x");
    expect(await removeRecordedRenders(dir)).toEqual([]);
    expect(existsSync(join(dir, "a.png"))).toBe(true);
  });

  it("removes only the named scene's pictures for a run of one scene, and keeps the rest recorded", async () => {
    const dir = folder();
    for (const file of ["a--default.png", "a--min.png", "b--default.png"]) {
      writeFileSync(join(dir, file), "x");
    }
    recordRenders(dir, ["a--default.png", "a--min.png", "b--default.png"]);

    const kept = await removeRecordedRenders(dir, "a");

    expect(kept).toEqual(["b--default.png"]);
    expect(existsSync(join(dir, "b--default.png"))).toBe(true);
    expect(existsSync(join(dir, "a--min.png"))).toBe(false);
  });

  it("ignores a record entry that names a path rather than a file in the folder", () => {
    const dir = folder();
    writeFileSync(
      join(dir, RENDERED_FILES_RECORD),
      JSON.stringify(["../outside.png", "ok.png", 3]),
    );
    expect(recordedRenders(dir)).toEqual(["ok.png"]);
  });
});

describe("the committed list of rendered pictures", () => {
  const dirs = (committed: string[] | null, generated: string[]) => {
    const have = folder();
    const want = folder();
    if (committed) recordRenders(have, committed);
    recordRenders(want, generated);
    return { have, want };
  };
  const differences = (have: string, want: string) => {
    const out: string[] = [];
    compareRenderRecord(have, want, out);
    return out;
  };

  it("says to commit it when pictures are drawn and no list is committed", () => {
    const { have, want } = dirs(null, ["a--default.png"]);
    expect(differences(have, want)).toEqual([
      expect.stringContaining("does not exist: commit it with the pictures"),
    ]);
  });

  it("names the pictures a committed list leaves out and the ones it lists wrongly", () => {
    const { have, want } = dirs(["old--default.png"], ["a--default.png"]);
    const [line] = differences(have, want);
    expect(line).toContain("not listed: a--default.png");
    expect(line).toContain("listed but not drawn: old--default.png");
  });

  it("is quiet when the lists agree, and when nothing is drawn", () => {
    const same = dirs(["a--default.png"], ["a--default.png"]);
    expect(differences(same.have, same.want)).toEqual([]);
    const none = dirs(null, []);
    expect(differences(none.have, none.want)).toEqual([]);
  });
});
