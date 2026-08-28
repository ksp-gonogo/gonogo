import { readdirSync, readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Where the tool is running and what it found there. Everything resolved once,
 * so no other module reaches for a path.
 *
 * Every lookup here goes through a PUBLISHED specifier or the invoking package's
 * own tree. The four hand-copied harnesses this replaces did not: two drivers
 * read `../../../../packages/theme/src/tokens.css` and
 * `../../../../packages/app/src/styles/global.css`, neither of which exists
 * outside this repository, and one of those files had stopped carrying a `:root`
 * block at all so the render threw. A repo-relative path is not an import, so the
 * isolation ratchet could never see either of them: having one harness rather
 * than nine is the fix, and resolving through published subpaths is what makes
 * the one harness runnable by someone else.
 */

const require = createRequire(import.meta.url);
const HERE = dirname(fileURLToPath(import.meta.url));

export interface UplinkPackage {
  /** The directory the tool was invoked in. Holds `package.json`. */
  dir: string;
  name: string;
  version: string;
  /** The client entry esbuild bundles, resolved per `resolveEntry`. */
  entry: string;
  /** `gonogo-render.setup.ts`, when the author wrote one. */
  setup?: string;
  /** Fixture files, sorted, `<dir>/src/**\/__fixtures__/*.json`. */
  fixtures: string[];
  /** Resolved `gonogo.renderWith` paths. See `resolveRenderWith`. */
  renderWith: string[];
}

export function readJson<T>(file: string): T {
  return JSON.parse(readFileSync(file, "utf8")) as T;
}

function exists(file: string): boolean {
  try {
    statSync(file);
    return true;
  } catch {
    return false;
  }
}

/**
 * The module esbuild bundles to make the Uplink's registrations happen.
 *
 * Source first, `main` second. An author iterating wants the file they are
 * editing, and a built `dist/index.js` renders whatever the last build contained,
 * which is a screenshot of a stale widget with nothing to say it is stale.
 */
function resolveEntry(dir: string, pkg: { main?: string }, override?: string) {
  if (override) return resolve(dir, override);
  for (const candidate of ["src/index.ts", "src/index.tsx"]) {
    const full = join(dir, candidate);
    if (exists(full)) return full;
  }
  if (pkg.main) {
    const full = resolve(dir, pkg.main);
    if (exists(full)) return full;
  }
  throw new Error(
    `gonogo-uplink: cannot find this Uplink client's entry module in ${dir}. ` +
      'Looked for src/index.ts, src/index.tsx, then package.json "main". ' +
      "Name it with --entry <path>.",
  );
}

function findFixtures(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry === "node_modules" || entry === "dist") continue;
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (
        entry.endsWith(".json") &&
        dirname(full).endsWith("__fixtures__")
      ) {
        out.push(full);
      }
    }
  };
  walk(join(root, "src"));
  return out.sort();
}

/**
 * Extra modules whose registrations belong in the page, declared once.
 *
 * A scene naming `_scene.host` needs that host widget in the bundle, and a
 * host widget ships with the APP, in a package no Uplink may import. `--with`
 * can name one per run, but a render that only works when someone remembers a
 * flag is a render nobody runs: the FIRST Uplink to use `_scene.host` shipped a
 * plain `gonogo-uplink render` script beside a fixture naming a host, which
 * cannot succeed. So the modules are a fact about the package, beside
 * `minAppVersion` in the same `gonogo` block:
 *
 *     "gonogo": { "renderWith": ["../../../packages/components/src/index.ts"] }
 *
 * Paths, not specifiers, and relative to the client directory: a specifier would
 * need a dependency the isolation rules forbid. In-repo only for the same
 * reason, which is why a missing file is an error naming the declaration rather
 * than a silent skip.
 */
function resolveRenderWith(dir: string, gonogo: unknown): string[] {
  const declared = (gonogo as { renderWith?: unknown } | undefined)?.renderWith;
  if (declared === undefined) return [];
  if (!Array.isArray(declared)) {
    throw new Error(
      `gonogo-uplink: "gonogo.renderWith" in ${join(dir, "package.json")} must ` +
        `be an array of module paths, got ${typeof declared}.`,
    );
  }
  return declared.map((entry) => {
    if (typeof entry !== "string") {
      throw new Error(
        `gonogo-uplink: every "gonogo.renderWith" entry must be a path ` +
          `string, got ${JSON.stringify(entry)}.`,
      );
    }
    const full = resolve(dir, entry);
    if (!exists(full)) {
      throw new Error(
        `gonogo-uplink: "gonogo.renderWith" names "${entry}", which resolves ` +
          `to ${full} and does not exist. It is a path relative to the client ` +
          "package, not a module specifier.",
      );
    }
    return full;
  });
}

export function resolveUplinkPackage(
  dir: string,
  opts: { entry?: string } = {},
): UplinkPackage {
  const manifestPath = join(dir, "package.json");
  if (!exists(manifestPath)) {
    throw new Error(
      `gonogo-uplink: no package.json in ${dir}. Run it from your Uplink ` +
        "client package directory, or pass --root <dir>.",
    );
  }
  const pkg = readJson<{
    name: string;
    version: string;
    main?: string;
    gonogo?: unknown;
  }>(manifestPath);
  const setup = ["gonogo-render.setup.ts", "gonogo-render.setup.tsx"]
    .map((f) => join(dir, f))
    .find(exists);
  return {
    dir,
    name: pkg.name,
    version: pkg.version,
    entry: resolveEntry(dir, pkg, opts.entry),
    setup,
    fixtures: findFixtures(dir),
    renderWith: resolveRenderWith(dir, pkg.gonogo),
  };
}

/**
 * The design tokens' `:root` block, from the kit's own published `tokens.css`.
 *
 * Resolved through the package specifier so it works from a third party's
 * node_modules, with the dist sibling as the fallback for the in-repo case where
 * the specifier resolves to a `dist/` that the caller is standing in.
 */
export function themeTokensCss(): string {
  const candidates = [
    () => require.resolve("@ksp-gonogo/ui-kit/tokens.css"),
    () => join(HERE, "tokens.css"),
    () => join(HERE, "..", "tokens.css"),
  ];
  const tried: string[] = [];
  for (const candidate of candidates) {
    let file: string;
    try {
      file = candidate();
    } catch {
      continue;
    }
    tried.push(file);
    if (!exists(file)) continue;
    const css = readFileSync(file, "utf8");
    const match = css.match(/:root\s*\{[\s\S]*?\}/);
    if (!match) {
      throw new Error(
        `gonogo-uplink: ${file} carries no ":root" block, so a render would ` +
          "have no colours. The kit publishes its tokens from " +
          "@ksp-gonogo/ui-kit/tokens.css; a file with no :root block is the " +
          "wrong file.",
      );
    }
    return match[0];
  }
  throw new Error(
    "gonogo-uplink: cannot resolve @ksp-gonogo/ui-kit/tokens.css. Tried:\n  " +
      `${tried.join("\n  ") || "(nothing resolved)"}\n` +
      "The kit copies it into its own dist during build, so an in-repo run " +
      "needs `pnpm --filter @ksp-gonogo/ui-kit build` first.",
  );
}

/** Which font a run is using, so nobody discovers it from a diff. */
export type FontMode = "locked" | "fallback";

export interface FontFace {
  mode: FontMode;
  css: string;
  /** Set when the locked font is unavailable, ready to print. */
  advice?: string;
}

/**
 * JetBrains Mono inlined as a data URI, matching the app's self-hosted face.
 *
 * An OPTIONAL peer, and the run reports which mode it is in rather than letting
 * someone find out from a diff: with the face absent a render uses whatever the
 * machine has, which is acceptable for a docs screenshot and disqualifying for a
 * pixel comparison. The four copied harnesses inlined nothing at all, so every
 * Uplink render to date has been in the machine's fallback font silently.
 */
export function jetbrainsMonoFace(): FontFace {
  const files = [
    { weight: 400, path: "jetbrains-mono-latin-400-normal.woff2" },
    { weight: 700, path: "jetbrains-mono-latin-700-normal.woff2" },
  ];
  const faces: string[] = [];
  for (const file of files) {
    let resolved: string;
    try {
      resolved = require.resolve(
        `@fontsource/jetbrains-mono/files/${file.path}`,
      );
    } catch {
      return {
        mode: "fallback",
        css: "",
        advice:
          "@fontsource/jetbrains-mono is not installed, so this render uses " +
          "the machine's fallback monospace font. Fine for a docs " +
          "screenshot, not comparable across machines. Install it with " +
          "`pnpm add -D @fontsource/jetbrains-mono`.",
      };
    }
    const b64 = readFileSync(resolved).toString("base64");
    faces.push(
      `@font-face{font-family:"JetBrains Mono";font-weight:${file.weight};` +
        `font-style:normal;src:url(data:font/woff2;base64,${b64}) format("woff2");}`,
    );
  }
  return { mode: "locked", css: faces.join("\n") };
}

/** A path as it should appear in a message: relative to the package, POSIX. */
export function display(dir: string, file: string): string {
  return relative(dir, file).split("\\").join("/");
}
