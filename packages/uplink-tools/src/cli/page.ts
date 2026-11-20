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
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { readUplinkDeclaration } from "@ksp-gonogo/sitrep-sdk/uplink-manifest";
import { PAGE_WRITE_ENV } from "../page-write-env";
import {
  buildClientlessReadme,
  pageRoot,
  README_GENERATED_MARKER,
} from "../render/docs";
import { findUplinkDir } from "./bake";
import { parseFlags } from "./flags";

export const PAGE_USAGE = `uplink-tools page [options]

  Write this Uplink's generated page (README.md at the Uplink's root, then
  gonogo-uplink.json, docs/widgets.json and docs/spec.json in the client) from what the client registers, with no browser. It runs
  the test that holds the page check, and only that one, with the check writing
  the page instead of comparing it, so the client's dependencies must be
  installed and the rest of the client's tests may be failing. It says which
  files it wrote. The pictures under docs/assets are left alone: docs renders
  those.

  An Uplink with no client package gets its README alone, written from
  uplink.json (name, description, mod and install), with no gonogo-uplink.json
  and no docs.

  --client <dir>   the Uplink's client package (default: client/ in the Uplink
                   the current directory is inside)
  --check          for an Uplink with no client: write nothing and exit 1 when
                   its README differs from what uplink.json gives`;

export function page(
  argv: readonly string[],
  cwd: string = process.cwd(),
): number {
  const { values, switches: flags } = parseFlags(argv, {
    verb: "page",
    usage: PAGE_USAGE,
    values: ["--client"],
    switches: ["--check"],
  });
  const named = values.get("--client");
  const uplinkDir = findUplinkDir(cwd);
  if (
    named === undefined &&
    uplinkDir &&
    !existsSync(join(uplinkDir, "client", "package.json"))
  ) {
    return clientlessPage(uplinkDir, flags.has("--check"));
  }
  if (flags.has("--check")) {
    throw new Error(
      "page --check is for an Uplink with no client. A client's page is compared by its own test, which calls expectUplinkPageCurrent().",
    );
  }
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
  const pageFiles = pageFilesOf(clientDir);
  const before = new Map(pageFiles.map((file) => [file, read(file)]));

  const result = spawnSync(
    "npx",
    [
      "vitest",
      "run",
      // A client config that passes with no tests would let a filter that matched nothing stand for a current page.
      "--no-passWithNoTests",
      ...checks.map((file) => relative(clientDir, file)),
    ],
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
  const wrote = pageFiles.filter((file) => read(file) !== before.get(file));
  console.log(
    wrote.length > 0
      ? `page: wrote ${wrote.join(", ")}`
      : "page: the README, gonogo-uplink.json, docs/widgets.json and docs/spec.json already match what the client registers. Nothing written.",
  );
  return 0;
}

/** The files the page check writes, relative to the client. The README sits at the Uplink's root, above it. */
function pageFilesOf(clientDir: string): string[] {
  return [
    relative(clientDir, join(pageRoot(clientDir), "README.md")),
    "gonogo-uplink.json",
    "docs/widgets.json",
    "docs/spec.json",
  ];
}

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

/** What `page --check` says when an Uplink with no client has no README. */
export const CLIENTLESS_README_MISSING =
  "page: README.md is missing. Run `uplink-tools page` to write it.";

/** What `page --check` says when the README differs from what uplink.json gives. */
export const CLIENTLESS_README_DIFFERS =
  "page: README.md is out of date. Run `uplink-tools page` to rewrite it.";

/**
 * The README of an Uplink with no client package, written from its `uplink.json`
 * alone, or compared with the committed one when `check` is set. A README that
 * lacks the generated marker was written by a person and is never overwritten.
 */
function clientlessPage(uplinkDir: string, check: boolean): number {
  const found = readUplinkDeclaration(uplinkDir);
  if (!found) throw new Error(`no uplink.json in ${uplinkDir}.`);
  const readme = buildClientlessReadme(found.declared);
  const path = join(uplinkDir, "README.md");
  const committed = existsSync(path) ? readFileSync(path, "utf8") : undefined;
  if (committed === readme) {
    console.log(
      "page: README.md already matches uplink.json. Nothing written.",
    );
    return 0;
  }
  if (check) {
    console.log(
      committed === undefined
        ? CLIENTLESS_README_MISSING
        : CLIENTLESS_README_DIFFERS,
    );
    return 1;
  }
  if (
    committed !== undefined &&
    !committed.startsWith(README_GENERATED_MARKER)
  ) {
    throw new Error(
      `${path} was not written by \`uplink-tools docs\` or \`uplink-tools page\`, so it was left alone. ` +
        "Move it aside (git mv README.md NOTES.md) and run page again.",
    );
  }
  writeFileSync(path, readme, "utf8");
  console.log("page: wrote README.md");
  return 0;
}
