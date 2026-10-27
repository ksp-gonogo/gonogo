import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * A probe render writes its page to the temp root and a page is about 20 MB,
 * so one that outlives its process fills the shared disk within a day of runs.
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const HELPER = pathToFileURL(join(ROOT, "scripts", "temp-dir.mjs")).href;

/** The shape every probe driver has: write the page, render, fail or finish. */
function render(outcome: "success" | "failure") {
  const body = `
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { makeTempDir } from ${JSON.stringify(HELPER)};
const page = join(makeTempDir("gonogo-probe-"), "gonogo-probe-hero-" + process.pid + ".html");
writeFileSync(page, "<html></html>");
console.log(page);
${outcome === "failure" ? `throw new Error("render failed");` : ""}`;
  const r = spawnSync(process.execPath, ["--input-type=module", "-e", body], {
    encoding: "utf8",
  });
  return { page: r.stdout.split("\n")[0], status: r.status };
}

describe("a probe render leaves no page behind", () => {
  it("after a successful render", () => {
    const { page, status } = render("success");
    expect(status).toBe(0);
    expect(page).toMatch(/\.html$/);
    expect(existsSync(page)).toBe(false);
    expect(existsSync(dirname(page))).toBe(false);
  });

  it("after a failing render", () => {
    const { page, status } = render("failure");
    expect(status).not.toBe(0);
    expect(existsSync(page)).toBe(false);
    expect(existsSync(dirname(page))).toBe(false);
  });
});

describe("no package script writes into the shared temp root directly", () => {
  it("every probe page path is made inside makeTempDir", () => {
    const files = execFileSync(
      "git",
      ["ls-files", "packages/*/scripts/*.ts", ":!:*.test.ts"],
      { cwd: ROOT, encoding: "utf8" },
    )
      .split("\n")
      .filter(Boolean);
    const offenders = files.filter((f) =>
      /(?:join|resolve)\(\s*tmpdir\(\)/.test(
        readFileSync(join(ROOT, f), "utf8"),
      ),
    );
    expect(offenders).toEqual([]);
  });
});
