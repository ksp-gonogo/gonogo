import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { orphanBaselineDirs } from "./orphanBaselines";

describe("orphanBaselineDirs", () => {
  let root = "";
  afterEach(async () => {
    if (root) await rm(root, { recursive: true, force: true });
  });

  async function seed(dirs: string[]): Promise<void> {
    root = await mkdtemp(join(tmpdir(), "orphan-baselines-"));
    for (const d of dirs) {
      await mkdir(join(root, d), { recursive: true });
      await writeFile(join(root, d, "a--default.png"), "");
    }
  }

  it("names a directory no config writes to", async () => {
    await seed(["kept-widget", "renamed-widget"]);
    const orphans = await orphanBaselineDirs(root, [
      { outPath: "renders/kept-widget" },
    ]);
    expect(orphans).toEqual(["renamed-widget"]);
  });

  it("owns nested directories by their full outPath, not their parent", async () => {
    await seed(["landing-status/currency", "landing-status/old"]);
    const orphans = await orphanBaselineDirs(root, [
      { outPath: "renders/landing-status/currency" },
    ]);
    expect(orphans).toEqual(["landing-status/old"]);
  });

  it("finds nothing when every directory is owned", async () => {
    await seed(["a", "b/c"]);
    const orphans = await orphanBaselineDirs(root, [
      { outPath: "renders/a" },
      { outPath: "renders/b/c" },
    ]);
    expect(orphans).toEqual([]);
  });
});
