// @vitest-environment node
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * One RC is one label. The app, the images, the mod zips and build-info.txt
 * all carry the label rc.yml's gate computes (or release.yml hands it), so a
 * publisher that derives a version of its own from the commit brings back the
 * disagreement between what the app, the zips and the packages call one RC.
 */

function findRepoRoot(start: string): string {
  let dir = start;
  while (dir !== "/") {
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) return dir;
    dir = dirname(dir);
  }
  throw new Error(`Could not locate workspace root from ${start}`);
}

const ROOT = findRepoRoot(dirname(fileURLToPath(import.meta.url)));
const workflows = join(ROOT, ".github/workflows");
const read = (name: string) => readFileSync(join(workflows, name), "utf8");
const expr = (inner: string) => `\${{ ${inner} }}`;

describe("the RC label", () => {
  it("is not derived from the commit in any workflow", () => {
    for (const file of readdirSync(workflows).filter((f) =>
      f.endsWith(".yml"),
    )) {
      const text = read(file);
      expect(text, file).not.toMatch(/-rc\.\$\{?\{?\s*(steps|SHA|short)/);
      expect(text, file).not.toMatch(/value=-?rc[-.]\$\{SHA/);
      expect(text, file).not.toMatch(/GONOGO_VERSION_SUFFIX/);
      expect(text, file).not.toMatch(/rc-\$\{SHA/);
    }
  });

  it.each([
    "deploy.yml",
    "publish-images.yml",
    "publish-mods.yml",
    "rc.yml",
  ])("%s takes the label as an input", (file) => {
    expect(read(file)).toMatch(/workflow_call:[\s\S]*?\n {6}label:/);
  });

  it("is passed by rc.yml to each publisher from its one gate output", () => {
    const rc = read("rc.yml");
    const passed = rc.match(
      new RegExp(
        `label: ${expr("needs.gate.outputs.label").replace(/[$.{}]/g, "\\$&")}`,
        "g",
      ),
    );
    expect(passed).toHaveLength(3);
  });

  it("is a dev label unless the caller gave one", () => {
    const rc = read("rc.yml");
    expect(rc).toMatch(/LABEL="\$release-dev\.\$short"/);
  });

  it("is the packages' own version when release.yml cuts an RC", () => {
    const release = read("release.yml");
    expect(release).toContain("uses: ./.github/workflows/rc.yml");
    expect(release).toContain(
      `label: ${expr("fromJSON(needs.rc-plan.outputs.plan).version")}`,
    );
  });

  it("is what the mod zips and the app build read, never a second spelling", () => {
    expect(read("publish-mods.yml")).toMatch(/echo "value=\$\{LABEL\}"/);
    expect(read("deploy.yml")).toContain(
      `GONOGO_VERSION: ${expr("inputs.label")}`,
    );
    expect(read("publish-images.yml")).toMatch(/VERSION="\$LABEL"/);
  });
});
