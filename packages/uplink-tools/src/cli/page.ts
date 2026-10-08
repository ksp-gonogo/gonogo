/**
 * `uplink-tools page`: writes the Uplink's generated page with no browser.
 *
 * The page is made from what the client registers, so the client has to be
 * evaluated, and the place a client is already evaluated without a browser is
 * its own test run: the page check there builds the page to compare it. This
 * runs the test files holding that check, and no others, with the check told
 * to write what it built.
 *
 * Only those files, because the page is usually stale at the same moment
 * something else is broken: an author who has just changed a widget has a
 * stale page and, often, a failing widget test. Running the whole suite made
 * each wait on the other, since `npm test` failed on the stale page and this
 * refused to write the page while any test failed.
 *
 * `uplink-tools docs` writes the same text and also renders the pictures, which
 * takes a Playwright browser. A fresh scaffold has none installed, and its first
 * page must not depend on one.
 */

import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { PAGE_WRITE_ENV } from "../page-write-env";
import { findUplinkDir } from "./bake";
import { parseFlags } from "./flags";

export const PAGE_USAGE = `uplink-tools page [options]

  Write this Uplink's generated page (README.md, gonogo-uplink.json and
  docs/widgets.json) from what the client registers, with no browser. It runs
  the test that holds the page check, and only that one, with the check writing
  the page instead of comparing it, so the client's dependencies must be
  installed and the rest of the client's tests may be failing. It says which
  files it wrote. The pictures under docs/assets are left alone: docs renders
  those.

  --client <dir>   the Uplink's client package (default: client/ in the Uplink
                   the current directory is inside)`;

export function page(
  argv: readonly string[],
  cwd: string = process.cwd(),
): number {
  const { values } = parseFlags(argv, {
    verb: "page",
    usage: PAGE_USAGE,
    values: ["--client"],
  });
  const named = values.get("--client");
  const uplinkDir = findUplinkDir(cwd);
  const clientDir =
    named !== undefined
      ? resolve(cwd, named)
      : uplinkDir && join(uplinkDir, "client");
  if (!clientDir || !existsSync(join(clientDir, "package.json"))) {
    throw new Error(
      `no client package found from ${cwd}. Run page inside an Uplink, or name its client with --client <dir>.`,
    );
  }
  if (!existsSync(join(clientDir, "node_modules"))) {
    throw new Error(
      `${clientDir} has no node_modules. The page is written by the client's own test run, so ` +
        "install its dependencies first: npm install",
    );
  }

  const checks = pageCheckFiles(join(clientDir, "src"));
  if (checks.length === 0) {
    throw new Error(
      `no test under ${join(clientDir, "src")} calls expectUplinkPageCurrent(), and that call is ` +
        "what writes the page. Add one, as the scaffold's src/uplink-page.test.ts does:\n\n" +
        '  import { expectUplinkPageCurrent } from "@ksp-gonogo/uplink-tools/page-check";\n' +
        '  import "./index.js";\n\n' +
        '  it("still describes what this Uplink registers", () => {\n' +
        "    expectUplinkPageCurrent();\n" +
        "  });",
    );
  }

  // What the page looked like before, read off disk: a passing test's own output is not printed by the runner, so the files are what says whether anything was written.
  const read = (file: string): string | undefined => {
    const path = join(clientDir, file);
    return existsSync(path) ? readFileSync(path, "utf8") : undefined;
  };
  const before = new Map(PAGE_FILES.map((file) => [file, read(file)]));

  const result = spawnSync(
    "npx",
    ["vitest", "run", ...checks.map((file) => relative(clientDir, file))],
    {
      cwd: clientDir,
      encoding: "utf8",
      env: { ...process.env, [PAGE_WRITE_ENV]: "1" },
      // npx is a batch file on Windows, which only a shell can start.
      shell: process.platform === "win32",
    },
  );
  if (result.error) {
    throw new Error(
      `could not run the client's page check: ${result.error.message}`,
    );
  }
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  if (result.status !== 0) {
    process.stdout.write(output);
    throw new Error(
      "the page was not written: the page check itself could not build it, and its message " +
        "above says why (a widget with no fixture, a fixture naming something the widget does " +
        "not have, a registration with no description). No other test of the client was run, " +
        "so nothing else is in the way.",
    );
  }
  const wrote = PAGE_FILES.filter((file) => read(file) !== before.get(file));
  console.log(
    wrote.length > 0
      ? `page: wrote ${wrote.join(", ")}`
      : "page: README.md, gonogo-uplink.json and docs/widgets.json already match what the client registers. Nothing written.",
  );
  return 0;
}

/** The three files the page check writes, relative to the client. */
export const PAGE_FILES = [
  "README.md",
  "gonogo-uplink.json",
  "docs/widgets.json",
];

/** The test files under `dir` that call the page check, which are the only ones `page` runs. */
export function pageCheckFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== "node_modules" && entry.name !== "__generated__") {
        found.push(...pageCheckFiles(path));
      }
      continue;
    }
    if (
      /\.test\.[cm]?[jt]sx?$/.test(entry.name) &&
      readFileSync(path, "utf8").includes("expectUplinkPageCurrent(")
    ) {
      found.push(path);
    }
  }
  return found.sort();
}
