// @vitest-environment node
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * One render process, and only one: `@ksp-gonogo/ui-kit`'s `gonogo-uplink`.
 *
 * Three Uplinks each grew their own Playwright driver and probe page, roughly
 * 2,300 lines between them, and the cost was not the duplication. It was that
 * "add a render" read as a day's work and got skipped, so the Uplink with the
 * newest widgets shipped with no pictures at all. All three are gone; this is
 * what stops a fourth.
 *
 * Two rules, and the reason they are two:
 *
 * - **an Uplink client does not drive a browser.** `playwright` stays in the
 *   devDependencies, because the shared tool needs a browser to launch and
 *   documents it as an optional peer. What it may not do is import it: a client
 *   that opens its own page has its own driver, whatever the file is called
 * - **an Uplink with fixtures runs the shared tool.** A fixture with nothing
 *   invoking it is a scene nobody renders, which looks exactly like an Uplink
 *   that has renders
 *
 * The second is the one with teeth against the failure this exercise found: the
 * RP-1 client had three `_scene` fixtures AND a hand-rolled driver that ignored
 * them, so `pnpm ... render` rendered a different set of pictures from the one the
 * fixtures described, and nothing said so.
 *
 * In `packages/core` rather than beside the Uplinks for the same reason the
 * isolation ratchet is: core is what an Uplink must not depend on, so a check
 * that needs to read every Uplink belongs on this side of the line, and it stops
 * having subjects rather than needing to move when they leave.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, "..", "..", "..");
const MOD = join(REPO_ROOT, "mod");

const SHARED_TOOL = "gonogo-uplink render";

/** The packages only a render DRIVER imports. Third-party, so nothing else in
 *  this repo's boundary rules has an opinion about them. */
const DRIVER_ONLY = ["playwright", "playwright-core", "puppeteer"];

/**
 * Directories that drive a browser for something other than rendering a widget,
 * with the reason. Prose rather than a glob, because "this one is fine" is a
 * claim someone should be able to check in a year.
 */
const NOT_A_RENDERER: Record<string, string> = {};

const SOURCE = /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/;

function walk(dir: string): string[] {
  const out: string[] = [];
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (entry === "node_modules" || entry === "dist") continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (SOURCE.test(entry)) out.push(full);
  }
  return out;
}

interface Client {
  id: string;
  dir: string;
  manifest: { scripts?: Record<string, string> };
  fixtures: number;
}

function uplinkClients(): Client[] {
  const clients: Client[] = [];
  for (const id of readdirSync(MOD).sort()) {
    if (!/^Gonogo.*Uplink$/.test(id)) continue;
    const dir = join(MOD, id, "client");
    const manifestPath = join(dir, "package.json");
    if (!existsSync(manifestPath)) continue;
    clients.push({
      id,
      dir,
      manifest: JSON.parse(readFileSync(manifestPath, "utf8")),
      fixtures: countFixtures(join(dir, "src")),
    });
  }
  return clients;
}

function countFixtures(root: string): number {
  let count = 0;
  const visit = (dir: string) => {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry === "node_modules" || entry === "dist") continue;
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) visit(full);
      else if (
        entry.endsWith(".json") &&
        dirname(full).endsWith("__fixtures__") &&
        // A SCENE fixture, which is what the tool consumes. The same directory
        // convention also holds plain test data in two Uplinks, and counting
        // those would demand a render of something that describes no scene.
        readFileSync(full, "utf8").includes('"_scene"')
      ) {
        count++;
      }
    }
  };
  visit(root);
  return count;
}

/** A floor, not an equality. A walk that matches nothing reports no violations,
 *  which is indistinguishable from a clean tree. */
const FLOOR = 7;

describe("one render process", () => {
  const clients = uplinkClients();

  it("finds the Uplink clients at all", () => {
    expect(clients.length).toBeGreaterThanOrEqual(FLOOR);
  });

  it("no Uplink client drives a browser of its own", () => {
    const offenders: string[] = [];
    for (const client of clients) {
      for (const file of walk(client.dir)) {
        const source = readFileSync(file, "utf8");
        for (const pkg of DRIVER_ONLY) {
          const imports =
            source.includes(`from "${pkg}"`) ||
            source.includes(`from '${pkg}'`) ||
            source.includes(`require("${pkg}")`) ||
            source.includes(`import("${pkg}")`);
          if (!imports) continue;
          const where = relative(REPO_ROOT, file).split("\\").join("/");
          if (Object.keys(NOT_A_RENDERER).some((d) => where.startsWith(d))) {
            continue;
          }
          offenders.push(`${where} imports ${pkg}`);
        }
      }
    }
    expect(
      offenders,
      `${offenders.length} file(s) launch their own browser:\n  ` +
        `${offenders.join("\n  ")}\n\n` +
        "Rendering is `gonogo-uplink render` from @ksp-gonogo/ui-kit, and " +
        "anything it cannot do gets ADDED to it rather than worked around in " +
        "one Uplink. A scene needing a fake only you can write goes in " +
        "client/gonogo-render.setup.ts; see docs/uplink-rendering.md.",
    ).toEqual([]);
  });

  it("every Uplink with fixtures renders them through the shared tool", () => {
    const offenders: string[] = [];
    for (const client of clients) {
      if (client.fixtures === 0) continue;
      const render = client.manifest.scripts?.render;
      if (render?.includes(SHARED_TOOL)) continue;
      offenders.push(
        `${client.id}: ${client.fixtures} fixture(s), but its "render" script ` +
          `is ${render ? JSON.stringify(render) : "absent"}`,
      );
    }
    expect(
      offenders,
      `${offenders.length} Uplink(s) have scenes nothing renders:\n  ` +
        `${offenders.join("\n  ")}\n\n` +
        `Add "render": "${SHARED_TOOL}" to the client's package.json. A ` +
        "fixture no script invokes is a scene nobody looks at, which reads " +
        "exactly like an Uplink that has renders.",
    ).toEqual([]);
  });
});
