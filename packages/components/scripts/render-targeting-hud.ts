#!/usr/bin/env tsx
/**
 * Renders Targeting's docking HUD to PNGs under
 * `local_docs/renders/targeting-hud/`, in both camera states: WITH a
 * `targeting.camera` backdrop and WITHOUT one.
 *
 * Two states because they are two different layout questions. Without a
 * backdrop the reticle frame is the only thing in the upper half, and the
 * question is whether it still reads as an instrument. With one, the video
 * fills that frame and the question is whether the readouts beside it survive
 * having a picture next to them. The standard `render-widget targeting` set
 * can only ever answer the first: no augment in this repo fills that slot, so
 * this is a dedicated probe (`targeting-hud-probe/`) that registers a stub
 * backdrop, the same pattern and the same reason as
 * `render-crew-status-avatar.ts`.
 *
 * Pass `--out-suffix <s>` to write into a sibling directory
 * (`targeting-hud-<s>/`), which is how a before/after pair is captured from
 * two states of the working tree without one clobbering the other.
 */
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build, type Plugin } from "esbuild";
import { chromium } from "playwright";
import type { TargetingHudProbePayload } from "./targeting-hud-probe/targeting-hud-probe-entry";

const require = createRequire(import.meta.url);

const HERE = dirname(fileURLToPath(import.meta.url));
const PROBE_DIR = resolve(HERE, "targeting-hud-probe");
const PROBE_ENTRY = join(PROBE_DIR, "targeting-hud-probe-entry.tsx");
const PROBE_HTML_TEMPLATE = join(PROBE_DIR, "targeting-hud-probe.html");
const RENDERS_ROOT = resolve(HERE, "../../../local_docs/renders");
const THEME_TOKENS_CSS = resolve(HERE, "../../theme/src/tokens.css");
const FIXTURE_PATH = resolve(
  HERE,
  "../src/Targeting/__fixtures__/docking-aligned.json",
);

/* Grid-unit -> pixel conversion, verbatim from `widgetRenderHarness.ts`
   (COL_WIDTH/ROW_HEIGHT/GRID_MARGIN), so these renders start at the same tile
   width the dashboard would actually give this widget at each size. */
const COL_WIDTH = 32;
const ROW_HEIGHT = 25;
const GRID_MARGIN = 8;

interface Mode {
  name: string;
  w: number;
  h: number;
}

/**
 * The three shapes the HUD composes differently: the default tile, a tall one
 * where the reticle frame gets most of the height, and the wide-short tile
 * that flips the readouts to a column beside the frame (`wideShort`, cols >= 12
 * and rows < 6).
 */
const MODES: Mode[] = [
  { name: "default-6x9", w: 6, h: 9 },
  { name: "tall-8x12", w: 8, h: 12 },
  { name: "landscape-18x5", w: 18, h: 5 },
];

/** The camera states, as the operator's own config switch expresses them. */
const CAMERA_STATES = [
  { name: "with-camera", hudMode: "hud-with-camera" },
  { name: "no-camera", hudMode: "hud" },
] as const;

// Same rationale as `render-crew-status-avatar.ts`'s own copy.
const cssSideEffectPlugin: Plugin = {
  name: "css-side-effect",
  setup(pluginBuild) {
    pluginBuild.onResolve({ filter: /\.css$/ }, (args) => {
      const resolvedPath = require.resolve(args.path, {
        paths: [args.resolveDir],
      });
      return { path: resolvedPath, sideEffects: true };
    });
    pluginBuild.onLoad({ filter: /\.css$/ }, async (args) => {
      const css = await readFile(args.path, "utf8");
      return {
        loader: "js",
        contents: `const __style = document.createElement("style");
__style.textContent = ${JSON.stringify(css)};
document.head.appendChild(__style);`,
      };
    });
  },
};

interface FixtureEmit {
  channel: string;
  value: unknown;
}

interface FixtureFile {
  _stream: {
    carriedChannels: string[];
    pinnedUt?: number;
    emits: FixtureEmit[];
  };
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const suffixFlag = args.indexOf("--out-suffix");
  const suffix = suffixFlag === -1 ? undefined : args[suffixFlag + 1];
  if (suffixFlag !== -1 && !suffix) {
    console.error("--out-suffix needs a value");
    process.exit(1);
  }
  const outDir = join(
    RENDERS_ROOT,
    suffix ? `targeting-hud-${suffix}` : "targeting-hud",
  );

  await mkdir(outDir, { recursive: true });
  await cleanArtifacts(outDir);

  const fixture: FixtureFile = JSON.parse(await readFile(FIXTURE_PATH, "utf8"));

  console.log("Bundling targeting-hud-probe-entry with esbuild...");
  const bundleResult = await build({
    entryPoints: [PROBE_ENTRY],
    bundle: true,
    format: "esm",
    target: "es2022",
    platform: "browser",
    jsx: "automatic",
    write: false,
    sourcemap: "inline",
    define: { "process.env.NODE_ENV": '"production"' },
    plugins: [cssSideEffectPlugin],
  });
  const bundleJs = bundleResult.outputFiles[0].text;

  const htmlTemplate = await readFile(PROBE_HTML_TEMPLATE, "utf8");
  const theme = themeCss(await readFile(THEME_TOKENS_CSS, "utf8"));
  const fontFace = await jetbrainsMonoFontFace();
  const escapedBundle = bundleJs.replace(/<\/script/gi, "<\\/script");
  const htmlWithBundle = htmlTemplate
    .replace(
      /<style id="probe-theme">[\s\S]*?<\/style>/,
      () => `<style id="probe-theme">${fontFace}${theme}</style>`,
    )
    .replace(
      '<script type="module" src="./targeting-hud-probe-entry.bundle.js"></script>',
      () => `<script type="module">${escapedBundle}</script>`,
    );

  const probeHtmlOut = join(
    tmpdir(),
    `gonogo-targeting-hud-probe-${process.pid}.html`,
  );
  await writeFile(probeHtmlOut, htmlWithBundle, "utf8");

  console.log("Launching Chromium...");
  const browser = await chromium.launch();
  try {
    for (const mode of MODES) {
      const pxW = mode.w * COL_WIDTH + (mode.w - 1) * GRID_MARGIN;
      const pxH = mode.h * ROW_HEIGHT + (mode.h - 1) * GRID_MARGIN;
      for (const state of CAMERA_STATES) {
        const context = await browser.newContext({
          viewport: { width: Math.max(pxW + 40, 320), height: pxH + 200 },
          deviceScaleFactor: 2,
        });
        const page = await context.newPage();
        page.on("pageerror", (err) =>
          console.error("  [page error]", err.message),
        );
        page.on("console", (msg) => {
          if (msg.type() === "error")
            console.error("  [console error]", msg.text());
        });
        await page.goto(pathToFileURL(probeHtmlOut).toString(), {
          waitUntil: "domcontentloaded",
        });
        await page.waitForFunction(
          () =>
            typeof (
              window as unknown as { __renderTargetingHudProbe?: unknown }
            ).__renderTargetingHudProbe === "function",
          undefined,
          { timeout: 10_000 },
        );

        const payload: TargetingHudProbePayload = {
          carriedChannels: fixture._stream.carriedChannels,
          pinnedUt: fixture._stream.pinnedUt,
          emits: fixture._stream.emits,
          config: { autoSwitch: true, hudMode: state.hudMode },
          w: mode.w,
          h: mode.h,
          pxW,
          pxH,
        };

        await page.evaluate(
          (p) =>
            (
              window as unknown as {
                __renderTargetingHudProbe: (payload: typeof p) => Promise<void>;
              }
            ).__renderTargetingHudProbe(p),
          payload,
        );

        /* The HUD is sized to its tile and never scrolls, so this is a plain
           tile-box shot: no `fullContent` growth pass, which would only
           stretch a frame that is already filling the height it was given. */
        const root = await page.$("#root");
        if (!root) throw new Error("Targeting-HUD probe: #root missing");
        const outName = `targeting-hud--${state.name}--${mode.name}.png`;
        await root.screenshot({ path: join(outDir, outName) });

        /* Reported alongside the picture, because two states can render
           pixel-identical while the DOM differs: this is what says the camera
           slot actually mounted (or did not), and how big the box it draws
           into is.

           Found through the RETICLE rather than by a selector on the frame:
           the reticle is the only element in the HUD with a stable inline
           signature (`border-radius: var(--radius-circle)`), and its
           `offsetParent` is the viewport box in both the framed and the
           unframed composition, so one query measures either. Selecting the
           frame directly would need markup that only one of the two has. */
        const measured = await page.evaluate(() => {
          const reticle = [
            ...document.querySelectorAll<HTMLElement>("div[style]"),
          ].find((el) => el.style.borderRadius === "var(--radius-circle)");
          const viewport = reticle?.offsetParent as HTMLElement | null;
          const box = viewport?.getBoundingClientRect();
          return {
            panel: document.querySelector("[data-panel-body]") !== null,
            title:
              document.querySelector("[data-panel-header] h3")?.textContent ??
              null,
            viewportW: box ? Math.round(box.width) : null,
            viewportH: box ? Math.round(box.height) : null,
            cameraMounted:
              document.querySelector("[data-stub-camera]") !== null,
          };
        });
        console.log(
          `  ${outName}  panel=${measured.panel} title=${measured.title ?? "-"} ` +
            `viewport=${measured.viewportW}x${measured.viewportH}px camera=${measured.cameraMounted}`,
        );

        await context.close();
      }
    }
    console.log(`\nRendered Targeting docking HUD -> ${outDir}`);
  } finally {
    await browser.close();
  }
}

/** Verbatim copy of `render-crew-status-avatar.ts`'s own helper. */
async function jetbrainsMonoFontFace(): Promise<string> {
  const regular = require.resolve(
    "@fontsource/jetbrains-mono/files/jetbrains-mono-latin-400-normal.woff2",
  );
  const bold = require.resolve(
    "@fontsource/jetbrains-mono/files/jetbrains-mono-latin-700-normal.woff2",
  );
  const b64 = async (p: string) => (await readFile(p)).toString("base64");
  return `
    @font-face{font-family:"JetBrains Mono";font-weight:400;font-style:normal;
      src:url(data:font/woff2;base64,${await b64(regular)}) format("woff2");}
    @font-face{font-family:"JetBrains Mono";font-weight:700;font-style:normal;
      src:url(data:font/woff2;base64,${await b64(bold)}) format("woff2");}
  `;
}

/** The theme sheet whole, checked to be the tokens file. The border-box reset
 *  the kit's primitives are drawn against sits outside the `:root` block. */
function themeCss(css: string): string {
  if (!/:root\s*\{/.test(css)) {
    throw new Error("tokens.css: no :root block found");
  }
  return css;
}

async function cleanArtifacts(dir: string): Promise<void> {
  const entries = await readdir(dir, { withFileTypes: true });
  let removed = 0;
  for (const e of entries) {
    if (!e.isFile() || !e.name.endsWith(".png")) continue;
    await rm(join(dir, e.name));
    removed++;
  }
  if (removed > 0) console.log(`Cleaned ${removed} stale PNG(s) from ${dir}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
