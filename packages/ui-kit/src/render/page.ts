import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build, type Plugin } from "esbuild";
import {
  type FontFace,
  jetbrainsMonoFace,
  themeTokensCss,
  type UplinkPackage,
} from "./context";

const require = createRequire(import.meta.url);
const HERE = dirname(fileURLToPath(import.meta.url));

/**
 * The page a scene is rendered in, built once per run.
 *
 * The browser entry is GENERATED rather than owned by each Uplink, and that is
 * load-bearing rather than tidy. The sdk's author surface is host-injected shims,
 * so a widget's module-load `registerComponent` throws against an uninstalled
 * host; static ES imports are hoisted above every statement, so an entry that
 * installs the host and then side-effect-imports the client is correct only by
 * import ORDER, which an import sorter is free to change. Generating the entry
 * moves that footgun out of every author's file into one place with no lines for
 * a sorter to move.
 */

/** The one `<style id="probe-theme">` slot and the one script slot. */
const PAGE_TEMPLATE = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Uplink render probe</title>
    <style id="probe-theme"></style>
    <style>
      html, body {
        margin: 0;
        padding: 0;
        background: var(--color-surface-app);
        color: var(--color-text-primary);
        font-family: var(--font-family-mono);
      }
      body {
        display: flex;
        align-items: center;
        justify-content: center;
        min-height: 100vh;
      }
    </style>
  </head>
  <body>
    <div id="root"></div>
    <script id="probe-entry" type="module"></script>
  </body>
</html>
`;

/**
 * A widget's own bare `import "some.css"` has to land in the page as a `<style>`
 * tag. `loader: "text"` alone makes an inert string module that esbuild then
 * tree-shakes away whenever the importing package declares `sideEffects: false`,
 * producing an ignored-bare-import warning and a fully unstyled render. Resolution
 * goes through Node's resolver rather than `pluginBuild.resolve()`, which
 * re-enters this same `onResolve` filter and hung the esbuild service.
 */
const cssSideEffectPlugin: Plugin = {
  name: "css-side-effect",
  setup(pluginBuild) {
    pluginBuild.onResolve({ filter: /\.css$/ }, (args) => ({
      path: require.resolve(args.path, { paths: [args.resolveDir] }),
      sideEffects: true,
    }));
    pluginBuild.onLoad({ filter: /\.css$/ }, async (args) => {
      const css = await readFile(args.path, "utf8");
      return {
        loader: "js",
        contents:
          'const __style = document.createElement("style");\n' +
          `__style.textContent = ${JSON.stringify(css)};\n` +
          "document.head.appendChild(__style);",
      };
    });
  },
};

function posix(path: string): string {
  return path.split("\\").join("/");
}

/**
 * One copy of the kit in the page, pinned to the file a consumer would get.
 *
 * `render-probe` reaches the kit by its own package NAME so the built file stays
 * a consumer of it, and this package's `tsconfig.json` maps that self-reference
 * back to `src/` for typechecking. esbuild honours the tsconfig nearest the
 * importing file, so bundling `dist/render-probe.js` pulled in the SOURCE kit
 * while every other importer got `dist/`: two augment registries, `registerAugment`
 * writing to a Map `<AugmentSlot>` never reads, which is the exact failure this
 * harness's header says having one probe was meant to prevent. It cost nothing
 * while an augment was only ever mounted in a stand-in host built from the same
 * copy; a scene naming a REAL host in another package is the first thing that
 * puts the two halves on opposite sides.
 *
 * Pinned to `dist` rather than `src` because that is what a third-party author
 * resolves, and a harness that renders something nobody else can run is not the
 * harness.
 */
function oneKitPerPage(): Record<string, string> {
  // This module ships as `dist/render.js`, so the three built files it has to
  // pin are its own siblings, whether that dist sits in this repo or in a third
  // party's `node_modules`. `require.resolve` cannot answer here: the kit's
  // `exports` declares only the `import` condition, which a CJS resolver
  // refuses outright.
  const alias: Record<string, string> = {};
  for (const [specifier, file] of [
    ["@ksp-gonogo/ui-kit", "index.js"],
    ["@ksp-gonogo/ui-kit/testing", "testing.js"],
    ["@ksp-gonogo/ui-kit/render-probe", "render-probe.js"],
  ]) {
    const built = join(HERE, file);
    // Absent means this is running from source, where the caller's own
    // resolution is the only one in play and is already a single copy.
    if (existsSync(built)) alias[specifier] = built;
  }
  return alias;
}

/** The generated browser entry. Awaited imports, never static ones. */
export function generateEntry(
  pkg: UplinkPackage,
  extraModules: readonly string[] = [],
): string {
  const lines = [
    "// GENERATED by @ksp-gonogo/ui-kit/render. Never committed, never edited.",
    'import { installRenderProbe } from "@ksp-gonogo/ui-kit/render-probe";',
    "",
    "// Before anything the Uplink registers: the host has to exist first, and a",
    "// static import of the client would be hoisted above this line.",
    "await installRenderProbe();",
  ];
  for (const module of extraModules) {
    lines.push(
      "// --with: registrations from outside this package, so a scene naming a",
      "// host widget has a real host to mount the augment inside.",
      `await import("${posix(module)}");`,
    );
  }
  lines.push(`await import("${posix(pkg.entry)}");`);
  if (pkg.setup) {
    lines.push(
      "// The author's own browser-side glue, when they wrote any.",
      `await import("${posix(pkg.setup)}");`,
    );
  }
  return `${lines.join("\n")}\n`;
}

export interface ProbePage {
  file: string;
  font: FontFace;
}

export async function buildProbePage(
  pkg: UplinkPackage,
  extraModules: readonly string[] = [],
): Promise<ProbePage> {
  const result = await build({
    stdin: {
      contents: generateEntry(pkg, extraModules),
      resolveDir: pkg.dir,
      sourcefile: "gonogo-render-entry.tsx",
      loader: "tsx",
    },
    bundle: true,
    format: "esm",
    target: "es2022",
    platform: "browser",
    jsx: "automatic",
    write: false,
    sourcemap: "inline",
    define: { "process.env.NODE_ENV": '"production"' },
    plugins: [cssSideEffectPlugin],
    alias: oneKitPerPage(),
    absWorkingDir: pkg.dir,
  });
  const bundle = result.outputFiles[0].text;
  const font = jetbrainsMonoFace();
  // Function-form replacements throughout: a React bundle contains `$&`, and
  // String.replace's string form reads it as a backreference and corrupts it.
  const escaped = bundle.replace(/<\/script/gi, "<\\/script");
  const html = PAGE_TEMPLATE.replace(
    '<style id="probe-theme"></style>',
    () => `<style id="probe-theme">${font.css}\n${themeTokensCss()}</style>`,
  ).replace(
    '<script id="probe-entry" type="module"></script>',
    () => `<script id="probe-entry" type="module">${escaped}</script>`,
  );
  const file = join(tmpdir(), `gonogo-uplink-probe-${process.pid}.html`);
  await writeFile(file, html, "utf8");
  return { file, font };
}
