/**
 * `uplink-tools page`: writes the Uplink's generated page with no browser.
 *
 * The page is made from what the client registers, so the client has to be
 * evaluated, and the place a client is already evaluated without a browser is
 * its own test run: the page check there builds the page to compare it. This
 * runs that suite once with the check told to write what it built.
 *
 * `uplink-tools docs` writes the same text and also renders the pictures, which
 * takes a Playwright browser. A fresh scaffold has none installed, and its first
 * page must not depend on one.
 */

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { PAGE_WRITE_ENV } from "../page-write-env";
import { findUplinkDir } from "./bake";
import { parseFlags } from "./flags";

export const PAGE_USAGE = `uplink-tools page [options]

  Write this Uplink's generated page (README.md, gonogo-uplink.json and
  docs/widgets.json) from what the client registers, with no browser. It runs
  the client's tests once, with the page check writing the page instead of
  comparing it, so the client's dependencies must be installed. The pictures
  under docs/assets are left alone: docs renders those.

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

  const result = spawnSync("npx", ["vitest", "run"], {
    cwd: clientDir,
    stdio: "inherit",
    env: { ...process.env, [PAGE_WRITE_ENV]: "1" },
    // npx is a batch file on Windows, which only a shell can start.
    shell: process.platform === "win32",
  });
  if (result.error) {
    throw new Error(
      `could not run the client's tests: ${result.error.message}`,
    );
  }
  if (result.status !== 0) {
    throw new Error(
      "the client's tests did not pass, so the page may not have been written. The page check " +
        "is one of them: it needs a test that calls expectUplinkPageCurrent(), as the scaffold's " +
        "src/uplink-page.test.ts does.",
    );
  }
  return 0;
}
