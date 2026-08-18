// @vitest-environment node
//
// Node realm rather than the package's jsdom default, matching
// `uplink-boundary.test.ts`: the shrink-only check transpiles the allowlist at a
// git ref through esbuild, which asserts a real TextEncoder/Uint8Array realm.
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { transformSync } from "esbuild";
import { describe, expect, it } from "vitest";
import {
  BLOCKED_FILENAMES,
  FORBIDDEN_PACKAGES,
  type ForbiddenPackage,
  INTERNAL_IMPORT_DEBT,
} from "./uplink-isolation.allowlist";

/**
 * Uplink isolation: an Uplink client may import the PUBLISHED surfaces
 * (`@ksp-gonogo/sitrep-sdk`, `@ksp-gonogo/ui-kit`) and nothing else from this
 * repo. Reaching into `core` / `components` / `data` / `ui` / `logger` makes the
 * Uplink unbuildable by a third-party author, which is the whole point of the
 * architecture.
 *
 * Runs the opposite direction to `uplink-boundary.test.ts`. Read that file's
 * header for the outward guard; this is the inward one, and its absence is why
 * 46 files accumulated unnoticed from the first day of the Uplink architecture.
 *
 * This lives in `packages/core` rather than beside the Uplinks on purpose: core
 * is what the Uplinks must NOT depend on, so core is the right place to own the
 * rule, and when the Uplinks eventually move to their own repos the guard simply
 * stops having subjects rather than needing to move with them.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, "..", "..", "..");
const MOD_DIR = join(REPO_ROOT, "mod");
const BASE_REF = process.env.RATCHET_BASE_REF ?? "origin/staging";
const ALLOWLIST_PATH = "packages/core/src/uplink-isolation.allowlist.ts";

/**
 * Terminated on both sides. An unterminated `@ksp-gonogo/ui` also matches
 * `@ksp-gonogo/ui-kit`, which is the PERMITTED package: that exact mistake
 * inflated a first pass at this audit from 15 real violations to 72 and sent the
 * remediation after four Uplinks that were clean. A word boundary does not save
 * you, because `-` is a non-word character and `\bui\b` matches inside `ui-kit`.
 */
const IMPORT_RE = new RegExp(
  `from\\s*["']@ksp-gonogo/(${FORBIDDEN_PACKAGES.join("|")})["']`,
  "g",
);

function uplinkSourceFiles(): string[] {
  if (!existsSync(MOD_DIR)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(MOD_DIR)) {
    if (!/^Gonogo.*Uplink$/.test(entry)) continue;
    const src = join(MOD_DIR, entry, "client", "src");
    if (!existsSync(src)) continue;
    walk(src, out);
  }
  return out;
}

function walk(dir: string, out: string[]): void {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === "dist") continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(entry)) out.push(full);
  }
}

function scan(): Map<string, Set<ForbiddenPackage>> {
  const found = new Map<string, Set<ForbiddenPackage>>();
  for (const file of uplinkSourceFiles()) {
    const rel = relative(REPO_ROOT, file).split("\\").join("/");
    const hits = new Set<ForbiddenPackage>();
    for (const m of readFileSync(file, "utf8").matchAll(IMPORT_RE)) {
      hits.add(m[1] as ForbiddenPackage);
    }
    if (hits.size > 0) found.set(rel, hits);
  }
  return found;
}

describe("uplink isolation", () => {
  /**
   * The instrument check, before any assertion that could pass by finding
   * nothing. A scan that walks zero files reports a clean repo, and a broken
   * path or a renamed directory looks exactly like success. `styleguide-earth-day`
   * shipped in that state for weeks.
   */
  it("actually scanned the Uplink clients", () => {
    const files = uplinkSourceFiles();
    expect(files.length).toBeGreaterThan(200);
    expect(
      new Set(files.map((f) => f.split("/mod/")[1]?.split("/")[0])).size,
    ).toBeGreaterThanOrEqual(8);
  });

  it("no Uplink client imports an app-internal package outside the debt list", () => {
    const found = scan();
    const unlisted: string[] = [];
    for (const [file, pkgs] of found) {
      const allowed = INTERNAL_IMPORT_DEBT[file];
      if (!allowed) {
        unlisted.push(`${file} -> ${[...pkgs].join(", ")}`);
        continue;
      }
      for (const pkg of pkgs) {
        if (!allowed.includes(pkg)) unlisted.push(`${file} -> ${pkg}`);
      }
    }
    expect(
      unlisted,
      [
        "An Uplink client imported an app-internal package.",
        "",
        "An Uplink may import @ksp-gonogo/sitrep-sdk and @ksp-gonogo/ui-kit only.",
        "Those are the published surfaces; a third-party Uplink author has no",
        "access to core/components/data/ui/logger, so an Uplink that imports one",
        "cannot be built outside this repo.",
        "",
        "Do NOT add these to the debt list: it is shrink-only and a new entry",
        "means new code just created the violation. Move the export you need into",
        "sitrep-sdk or ui-kit and re-point the import.",
        "",
        "See docs/uplink-isolation.md.",
      ].join("\n"),
    ).toEqual([]);
  });

  it("does not re-introduce a blocked strategy", () => {
    const offenders = uplinkSourceFiles()
      .map((f) => relative(REPO_ROOT, f).split("\\").join("/"))
      .filter((f) => BLOCKED_FILENAMES.some((b) => f.endsWith(`/${b}`)));
    expect(
      offenders,
      [
        "A blocked strategy came back.",
        "",
        "These are patterns removed rather than allowlisted, because they need an",
        "app-internal import to work at all. A gate a third-party Uplink author",
        "cannot run is not a gate. Put the check app-side.",
        "",
        "See BLOCKED_FILENAMES in uplink-isolation.allowlist.ts for each one's story.",
      ].join("\n"),
    ).toEqual([]);
  });

  it("the debt list only ever shrinks", () => {
    let baseSource: string;
    try {
      baseSource = execFileSync(
        "git",
        ["show", `${BASE_REF}:${ALLOWLIST_PATH}`],
        { cwd: REPO_ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
      );
    } catch {
      // No base (first land, shallow clone, detached CI ref): nothing to diff
      // against. Soft-pass, same as `uplink-boundary` does.
      return;
    }
    const js = transformSync(baseSource, { loader: "ts", format: "cjs" }).code;
    const module_ = { exports: {} as Record<string, unknown> };
    new Function("module", "exports", js)(module_, module_.exports);
    const baseDebt = module_.exports.INTERNAL_IMPORT_DEBT as
      | Record<string, readonly ForbiddenPackage[]>
      | undefined;
    if (!baseDebt) return;

    const added: string[] = [];
    for (const [file, pkgs] of Object.entries(INTERNAL_IMPORT_DEBT)) {
      const before = baseDebt[file];
      if (!before) {
        added.push(`${file} (whole entry)`);
        continue;
      }
      for (const pkg of pkgs) {
        if (!before.includes(pkg)) added.push(`${file} -> ${pkg}`);
      }
    }
    expect(
      added,
      `Debt entries may only be REMOVED, never added, vs ${BASE_REF}. See docs/uplink-isolation.md.`,
    ).toEqual([]);
  });
});
