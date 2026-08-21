import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Every jsdom vitest project must set an explicit `testTimeout` of at least 30s.
 *
 * Vitest's 5s default is a HANG detector, and `turbo test` turns it into a speed
 * limit. The root `test` script fans ~22 suites out at turbo's default
 * concurrency of 10, each vitest pool sizing its worker count off the machine's
 * cpu count, against a 4-vCPU CI runner. Every test is dilated by an order of
 * magnitude, so what trips first is whichever test is SLOWEST, not whichever is
 * wrong: measured on `components`, the same suite ran 59s alone and 188s beside
 * the others.
 *
 * That is not a hypothetical. `test` was red on staging for seven consecutive
 * runs in August 2026 and the timing-out test was DIFFERENT nearly every run
 * (`ManeuverPlanner` armed triggers, a `ThermalStatus` characterisation, an
 * `AtmosphereProfile` snapshot, an Uplink's axe assertion), which is the
 * signature of a budget being missed rather than a defect being found. Worse, a
 * timed-out test does not stop: its in-flight `userEvent` work keeps running into
 * the tests after it, so ONE timeout reported ten failures, nine of them
 * describing a widget that rendered nothing. Two investigations chased the widget
 * and the build before anyone read the first failure.
 *
 * 30s is the number nine Uplink clients and (at 90s) `packages/core` already
 * chose for exactly this reason. This guard exists because the seven packages
 * that never got it could not tell you they hadn't: an absent `testTimeout` is
 * indistinguishable from a considered one, and it is only ever discovered by a
 * red CI run blaming an innocent test.
 *
 * Node-environment projects are out of scope deliberately. They build no jsdom,
 * their suites run in milliseconds, and none of them has ever timed out.
 *
 * Lives in `@ksp-gonogo/core` because that is where this repo keeps cross-package
 * structural ratchets (see `ci-test-project-coverage.test.ts`).
 */

/** The floor, matching the Uplink clients' existing choice. */
const MINIMUM_JSDOM_TIMEOUT_MS = 30_000;

function findRepoRoot(start: string): string {
  let dir = start;
  while (dir !== "/") {
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) return dir;
    dir = dirname(dir);
  }
  throw new Error(`Could not locate workspace root from ${start}`);
}

const ROOT = findRepoRoot(dirname(fileURLToPath(import.meta.url)));

function findVitestConfigs(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === "dist" || entry.startsWith("."))
      continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) findVitestConfigs(full, found);
    else if (entry === "vitest.config.ts") found.push(full);
  }
  return found;
}

interface Project {
  path: string;
  jsdom: boolean;
  timeoutMs: number | null;
}

/**
 * Parsed by shape rather than imported: importing every config would execute
 * each one's plugins and alias resolution, which is a great deal of work and a
 * great deal that can fail, for two fields. A config that stops matching these
 * shapes reads as "no jsdom, no timeout" and would pass silently, so
 * `sees the projects it already knows about` below pins the parse against the
 * known population.
 */
function readProjects(): Project[] {
  return [join(ROOT, "packages"), join(ROOT, "mod")]
    .flatMap((dir) => findVitestConfigs(dir))
    .map((path) => {
      const source = readFileSync(path, "utf8");
      const timeout = source.match(/testTimeout:\s*([0-9_]+)/);
      return {
        path: relative(ROOT, path),
        jsdom: /environment:\s*"jsdom"/.test(source),
        timeoutMs: timeout ? Number(timeout[1].replace(/_/g, "")) : null,
      };
    })
    .sort((a, b) => a.path.localeCompare(b.path));
}

describe("every jsdom vitest project sets an explicit test timeout", () => {
  it("sees the projects it already knows about", () => {
    // A parse that matched nothing would report every project as node-environment
    // with no timeout, and the assertion below would pass having checked nothing:
    // the exact shape of blindness this file exists to prevent.
    const projects = readProjects();
    expect(projects.length).toBeGreaterThan(15);
    expect(projects.filter((p) => p.jsdom).length).toBeGreaterThan(10);
    expect(
      projects.map((p) => p.path),
      "the components suite is the one this guard was written for, so a parse " +
        "that cannot find it is broken rather than satisfied",
    ).toContain("packages/components/vitest.config.ts");
  });

  it("gives every jsdom project at least 30s", () => {
    const short = readProjects()
      .filter((p) => p.jsdom)
      .filter(
        (p) => p.timeoutMs === null || p.timeoutMs < MINIMUM_JSDOM_TIMEOUT_MS,
      )
      .map((p) => `${p.path} (${p.timeoutMs ?? "unset, so vitest's 5s"})`);
    expect(
      short,
      `these jsdom projects run under a timeout below ${MINIMUM_JSDOM_TIMEOUT_MS}ms. ` +
        `Beside ~10 sibling suites on a 4-vCPU runner that budget fails the slowest ` +
        `test rather than a wrong one, and the timed-out test then corrupts the ones ` +
        `after it. Set testTimeout: 30_000`,
    ).toEqual([]);
  });
});
