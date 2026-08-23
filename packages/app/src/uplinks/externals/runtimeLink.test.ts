// @vitest-environment node
//
// Node realm rather than the package's jsdom default: this test shells out to
// esbuild and reads the filesystem, and needs no DOM.
import { existsSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { LOADER_UPLINK_IDS } from "../flag";
import {
  UPLINK_EXTERNAL_ENTRIES,
  UPLINK_EXTERNAL_NO_CHUNK,
  UPLINK_EXTERNAL_SPECIFIERS,
} from "./entries";

/**
 * A runtime-loaded Uplink's imports must all resolve through the baked import
 * map at load.
 *
 * The failure this exists for is silent in every other check. A subpath of a
 * PERMITTED package (`@ksp-gonogo/sitrep-sdk/spine`) typechecks, passes the
 * Uplink isolation ratchet, and esbuilds without a warning: esbuild externalises
 * a subpath of an externalised package name, so the bare specifier survives into
 * the bundle untouched and the build reports success. It then fails at
 * `import(bundleUrl)` in the browser, because an import map matches a key
 * without a trailing slash EXACTLY and there is no key for the subpath. That is
 * why `/media` has its own entry, and it was why `/spine` did not resolve.
 *
 * Two properties make this the honest experiment rather than a restatement of
 * the config:
 *
 * 1. It builds the REAL loader clients, with the REAL external list, through the
 *    same esbuild call the Vite plugin makes. A statically bundled Uplink
 *    resolves its imports through Vite and never touches the import map, so a
 *    test using one would report clean no matter what the map contained.
 * 2. It resolves the surviving specifiers the way a browser does, against the
 *    key set the plugin actually emits (an entry with no `ext-*.ts` on disk
 *    emits no chunk and therefore no key), rather than against the declared
 *    list.
 */

const APP_DIR = resolve(import.meta.dirname, "..", "..", "..");
const MOD_DIR = resolve(APP_DIR, "..", "..", "mod");

/**
 * The client directory of every Uplink the loader boots, matched from
 * `LOADER_UPLINK_IDS` to the `Gonogo<Mod>Uplink` directory naming it.
 *
 * Derived rather than listed because a hardcoded id -> directory table would put
 * mod names in `src/`, which the mod-ownership boundary guard exists to stop.
 * The ids come from `flag.ts`, which already owns them, and the directory names
 * come off disk. A descriptor id would be tidier but not every loader client
 * ships a `gonogo-uplink.json`, so keying on one silently drops a client, and a
 * dropped client is a check that passes while covering less than it claims.
 *
 * Ambiguity throws rather than picking: two directories matching one id means
 * the naming assumption has stopped holding.
 */
function loaderClientDirs(): { id: string; dir: string }[] {
  const uplinkDirs = readdirSync(MOD_DIR).filter((entry) =>
    /^Gonogo.*Uplink$/.test(entry),
  );
  return LOADER_UPLINK_IDS.map((id) => {
    const matches = uplinkDirs.filter(
      (entry) =>
        entry.toLowerCase().includes(id.toLowerCase()) &&
        existsSync(join(MOD_DIR, entry, "client", "src", "index.ts")),
    );
    if (matches.length !== 1) {
      throw new Error(
        `expected exactly one Uplink client directory for "${id}", found ${matches.length}: ${matches.join(", ")}`,
      );
    }
    return { id, dir: join(MOD_DIR, matches[0] as string, "client") };
  });
}

/**
 * The slice of esbuild's `build` this test uses.
 *
 * Declared structurally rather than as `typeof import("esbuild")` because the
 * app does not depend on esbuild and must not start: `vite.config.ts` resolves
 * it from an Uplink client for exactly that reason, and a type-only import here
 * would still be a compile-time dependency the app cannot satisfy.
 */
interface EsbuildSlice {
  build(options: Record<string, unknown>): Promise<{
    metafile: {
      outputs: Record<
        string,
        { imports?: { path: string; external?: boolean }[] }
      >;
    };
  }>;
}

/**
 * esbuild, resolved from an Uplink client exactly as the Vite plugin resolves
 * it: it is a devDependency of each client, not of the app.
 */
function loadEsbuild(clients: { dir: string }[]): EsbuildSlice {
  const first = clients[0];
  if (first === undefined) throw new Error("no loader Uplink clients found");
  const clientRequire = createRequire(join(first.dir, "package.json"));
  return clientRequire("esbuild") as EsbuildSlice;
}

/**
 * The specifiers the baked import map will carry a key for: a declared entry
 * whose `ext-*.ts` exists, because the plugin keys the map off emitted entry
 * chunks and Rollup emits a chunk only for an input that is on disk.
 */
function importMapKeys(): Set<string> {
  const keys = new Set<string>();
  for (const [specifier, entryName] of UPLINK_EXTERNAL_ENTRIES) {
    if (existsSync(join(import.meta.dirname, `${entryName}.ts`))) {
      keys.add(specifier);
    }
  }
  return keys;
}

/**
 * A browser's bare-specifier resolution, for the map shape this app bakes.
 *
 * Only bare specifiers consult the import map; a relative or absolute one
 * resolves against the bundle URL and needs no key. Every key the plugin emits
 * is a bare package specifier with no trailing slash, so the only rule that can
 * fire is an exact match: there is deliberately no prefix fallback here, since
 * assuming one is the mistake that made `/spine` look resolvable.
 */
function resolvesAtLoad(specifier: string, keys: Set<string>): boolean {
  if (specifier.startsWith(".") || specifier.startsWith("/")) return true;
  if (/^[a-z][a-z0-9+\-.]*:/i.test(specifier)) return true;
  return keys.has(specifier);
}

/** Every specifier esbuild left unresolved in a bundle of `entryPoints`. */
async function externalSpecifiers(
  esbuild: EsbuildSlice,
  absWorkingDir: string,
  entryPoints: string[],
  stdin?: { contents: string; sourcefile: string },
): Promise<string[]> {
  const result = await esbuild.build({
    ...(stdin === undefined
      ? { entryPoints }
      : { stdin: { ...stdin, resolveDir: absWorkingDir, loader: "ts" } }),
    bundle: true,
    write: false,
    format: "esm",
    platform: "browser",
    target: "es2022",
    jsx: "automatic",
    external: [...UPLINK_EXTERNAL_SPECIFIERS, ...UPLINK_EXTERNAL_NO_CHUNK],
    absWorkingDir,
    logLevel: "silent",
    metafile: true,
    // The link surface is a JS question. Stylesheets reach a loaded bundle as an
    // injected <style> and carry no module specifiers, so emptying them keeps
    // this test off the CSS pipeline without changing what it measures.
    loader: { ".css": "empty" },
  });
  const specifiers = new Set<string>();
  for (const output of Object.values(result.metafile.outputs)) {
    for (const imported of output.imports ?? []) {
      if (imported.external) specifiers.add(imported.path);
    }
  }
  return [...specifiers].sort();
}

/**
 * A client importing the frame arithmetic from the `/frames` author surface.
 *
 * **This file cannot see a NAME, only a specifier.** The sdk is marked external,
 * so esbuild never resolves the module: renaming `frameVector` on the barrel
 * leaves all six tests here green, measured. The names below are written out so
 * the probe reads like the client it stands in for, and the surface itself is
 * pinned by `mod/sitrep-sdk/src/frames/frames.test-d.ts`, which `tsc` compiles
 * against the real declarations and which reported two diagnostics for that same
 * rename. What THIS answers is the one question that check cannot: whether a
 * browser could have found the module at all.
 */
const FRAMES_PROBE_SOURCE = `
import {
  type FrameCoordinates,
  type FrameInstant,
  frameInstantAt,
  frameVector,
  fromFrame,
  READ_FRAME_KINDS,
  type ReadFrameChoice,
  type ReadFrameKind,
  resolveReadFrame,
  type SystemInstant,
  systemInstantAt,
  toFrame,
  TRAJECTORY_SCALE_CONVENTIONS,
  type TrajectoryScaleConvention,
  type Vector3,
} from "@ksp-gonogo/sitrep-sdk/frames";

export const probe = {
  frameInstantAt,
  frameVector,
  fromFrame,
  READ_FRAME_KINDS,
  resolveReadFrame,
  systemInstantAt,
  toFrame,
  TRAJECTORY_SCALE_CONVENTIONS,
};
export type Probe = [
  FrameCoordinates,
  FrameInstant,
  ReadFrameChoice,
  ReadFrameKind,
  SystemInstant,
  TrajectoryScaleConvention,
  Vector3,
];
`;

// The read-frame and libration-point arithmetic that lives on the `/spine`
// subpath, which first-party code reaches and an Uplink author may not. Named
// individually so the probe reads like a real client; as above, a rename is
// invisible here because the specifier is externalised rather than resolved.
const SPINE_PROBE_SOURCE = `
import {
  type CelestialFacts,
  type FrameInstant,
  frameInstantAt,
  fromFrame,
  lagrangePointsAt,
  type ReadFrameChoice,
  toFrame,
} from "@ksp-gonogo/sitrep-sdk/spine";

export const probe = {
  frameInstantAt,
  fromFrame,
  lagrangePointsAt,
  toFrame,
};
export type Probe = [CelestialFacts, FrameInstant, ReadFrameChoice];
`;

describe("runtime-loaded Uplink link surface", () => {
  const clients = loaderClientDirs();
  const esbuild = loadEsbuild(clients);

  it("finds a client for every id the loader boots", () => {
    expect(clients.map((c) => c.id).sort()).toEqual(
      [...LOADER_UPLINK_IDS].sort(),
    );
  });

  it("has an ext-*.ts on disk for every declared entry", () => {
    const declared = UPLINK_EXTERNAL_ENTRIES.map(([s]) => s);
    const missing = declared.filter((s) => !importMapKeys().has(s));
    expect(missing).toEqual([]);
  });

  it("sees the specifiers a real client leaves external, so a pass means something", async () => {
    const seen = new Set<string>();
    for (const { dir } of clients) {
      for (const specifier of await externalSpecifiers(esbuild, dir, [
        join(dir, "src/index.ts"),
      ])) {
        seen.add(specifier);
      }
    }
    // If the extractor ever stops seeing these, every assertion below passes
    // against an empty list. The subpath matters most: a loader client already
    // relies on one, so the mechanism under test is live rather than
    // hypothetical.
    expect(seen).toContain("@ksp-gonogo/sitrep-sdk");
    expect([...seen].filter((s) => s.includes("/sitrep-sdk/"))).not.toEqual([]);
  });

  it("resolves every specifier the real loader clients leave external", async () => {
    const keys = importMapKeys();
    const unresolved: string[] = [];
    for (const { id, dir } of clients) {
      const found = await externalSpecifiers(esbuild, dir, [
        join(dir, "src/index.ts"),
      ]);
      for (const specifier of found) {
        if (!resolvesAtLoad(specifier, keys)) {
          unresolved.push(`${id} imports unmapped "${specifier}"`);
        }
      }
    }
    expect(unresolved).toEqual([]);
  });

  /**
   * Build one probe as a runtime-loaded Uplink client would be built, and report
   * what a browser could not resolve.
   *
   * Runs from a real client's directory so the probe resolves the sdk through an
   * Uplink's own `node_modules`, which is the only place the subpath's `exports`
   * map is consulted the way an outside author's build would consult it.
   */
  async function unresolvedFor(
    sourcefile: string,
    contents: string,
  ): Promise<{ found: string[]; unresolved: string[] }> {
    const first = clients[0];
    if (first === undefined) throw new Error("no loader Uplink clients found");
    const found = await externalSpecifiers(esbuild, first.dir, [], {
      contents,
      sourcefile,
    });
    const keys = importMapKeys();
    return { found, unresolved: found.filter((s) => !resolvesAtLoad(s, keys)) };
  }

  it("resolves the frame arithmetic imported from the /frames subpath", async () => {
    const { found, unresolved } = await unresolvedFor(
      "frames-probe.ts",
      FRAMES_PROBE_SOURCE,
    );

    // The premise: esbuild leaves the subpath alone rather than inlining it, so
    // nothing before load can notice a missing key.
    expect(found).toContain("@ksp-gonogo/sitrep-sdk/frames");
    expect(unresolved).toEqual([]);
  });

  it("resolves the frame arithmetic imported from the /spine subpath", async () => {
    const { found, unresolved } = await unresolvedFor(
      "spine-probe.ts",
      SPINE_PROBE_SOURCE,
    );

    expect(found).toContain("@ksp-gonogo/sitrep-sdk/spine");
    expect(unresolved).toEqual([]);
  });
});
