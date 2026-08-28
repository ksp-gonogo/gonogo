#!/usr/bin/env tsx
/**
 * Renders CrewStatus's per-row `crew-status.avatar` slot to PNGs under
 * `local_docs/renders/crew-status-avatar/`, showing the avatar-LEFT-of-
 * the-WHOLE-block row layout (avatar column | name + wrapping badge +
 * survival meters stacked to its right) at narrow/default/wide sizes.
 *
 * The standard widget probe never registers an avatar augment (no facecam
 * source in the harness), so this is a dedicated probe (`crew-avatar-probe/`),
 * same esbuild -> injected HTML -> playwright pipeline as
 * `render-crew-status-panel-badge.ts`, that registers a plain-initials
 * STUB avatar augment before mounting the real `CrewStatusComponent`
 * (`crew-avatar-probe-entry.tsx`'s own doc comment). Replays the existing
 * `crew-critical.json` fixture (already used by the panel-badge render and
 * the kerbalism-crew-survival widget-render set) so the avatar column shows
 * up alongside a REAL per-row badge + survival meter, which is the case that
 * shows whether the avatar is spanning the whole row block rather than
 * sitting next to the name alone and dragging the badge low.
 *
 * Sizes mirror the `crew-status/kerbalism-survival` render-widget config
 * (`widgets.ts`) so this set is directly comparable to the no-avatar
 * renders: narrow-4x10 (badge-wrap width floor), default-6x8 (defaultSize),
 * wide-9x12 (roomy review shot).
 */
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build, type Plugin } from "esbuild";
import { chromium } from "playwright";
import type { CrewAvatarProbePayload } from "./crew-avatar-probe/crew-avatar-probe-entry";

const require = createRequire(import.meta.url);

const HERE = dirname(fileURLToPath(import.meta.url));
const PROBE_DIR = resolve(HERE, "crew-avatar-probe");
const PROBE_ENTRY = join(PROBE_DIR, "crew-avatar-probe-entry.tsx");
const PROBE_HTML_TEMPLATE = join(PROBE_DIR, "crew-avatar-probe.html");
const OUT_DIR = resolve(HERE, "../../../local_docs/renders/crew-status-avatar");
const THEME_TOKENS_CSS = resolve(HERE, "../../theme/src/tokens.css");
const FIXTURE_PATH = resolve(
  HERE,
  "../src/CrewStatus/__render_kerbalism_survival__/crew-critical.json",
);

// Grid-unit -> pixel conversion, verbatim from `widgetRenderHarness.ts`
// (COL_WIDTH/ROW_HEIGHT/GRID_MARGIN), so these renders start at the same
// tile width the dashboard would actually give this widget at each size.
const COL_WIDTH = 32;
const ROW_HEIGHT = 25;
const GRID_MARGIN = 8;

interface Mode {
  name: string;
  w: number;
  h: number;
}

// Mirrors `widgets.ts`'s `crew-status/kerbalism-survival` mode set, so
// this render is directly comparable to the no-avatar renders produced by
// `render-widget crew-status`.
const MODES: Mode[] = [
  { name: "narrow-4x10", w: 4, h: 10 },
  { name: "default-6x8", w: 6, h: 8 },
  { name: "wide-9x12", w: 9, h: 12 },
];

// Same rationale as `render-crew-status-panel-badge.ts`'s own copy.
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
  meta?: unknown;
}

interface FixtureFile {
  _stream: {
    carriedChannels: string[];
    pinnedUt?: number;
    emits: FixtureEmit[];
  };
}

async function main(): Promise<void> {
  await mkdir(OUT_DIR, { recursive: true });
  await cleanArtifacts(OUT_DIR);

  const fixture: FixtureFile = JSON.parse(await readFile(FIXTURE_PATH, "utf8"));

  console.log("Bundling crew-avatar-probe-entry with esbuild…");
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
      '<script type="module" src="./crew-avatar-probe-entry.bundle.js"></script>',
      () => `<script type="module">${escapedBundle}</script>`,
    );

  const probeHtmlOut = join(
    tmpdir(),
    `gonogo-crew-avatar-probe-${process.pid}.html`,
  );
  await writeFile(probeHtmlOut, htmlWithBundle, "utf8");

  console.log("Launching Chromium…");
  const browser = await chromium.launch();
  try {
    for (const mode of MODES) {
      const pxW = mode.w * COL_WIDTH + (mode.w - 1) * GRID_MARGIN;
      const pxH = mode.h * ROW_HEIGHT + (mode.h - 1) * GRID_MARGIN;
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
          typeof (window as unknown as { __renderCrewAvatarProbe?: unknown })
            .__renderCrewAvatarProbe === "function",
        undefined,
        { timeout: 10_000 },
      );

      const payload: CrewAvatarProbePayload = {
        carriedChannels: fixture._stream.carriedChannels,
        pinnedUt: fixture._stream.pinnedUt,
        emits: fixture._stream.emits,
        w: mode.w,
        h: mode.h,
        pxW,
        pxH,
      };

      await page.evaluate(
        (p) =>
          (
            window as unknown as {
              __renderCrewAvatarProbe: (payload: typeof p) => Promise<void>;
            }
          ).__renderCrewAvatarProbe(p),
        payload,
      );

      // Grow `#root` to swallow any vertical overflow so the PNG shows the
      // WHOLE roster (all three crew-critical rows, badges + meters), never
      // a tile-height crop. Based on `widgetRenderHarness.ts`'s own
      // `fullContent` technique, EXTENDED with `[data-panel-body]`: Panel's
      // own body box (`PanelBody__Box`, ui-kit's `Panel.tsx`) is CrewStatus's
      // actual scroller (`overflow: auto`, its own nested scroll context), not
      // `[data-scroll-area-inner]` (a different, opt-in wrapper other widgets
      // use). A nested scroll context clips independently of its ancestors, so
      // without measuring it directly, a deficit hidden behind Panel's body
      // scroll (e.g. a third crew row) never gets counted and #root grows to
      // fit nothing, cropping the roster silently.
      await page.evaluate(() => {
        const el = document.getElementById("root");
        if (!el) return;
        el.style.overflow = "visible";
        for (let i = 0; i < 8; i++) {
          const nodes = [
            el,
            el.firstElementChild,
            ...document.querySelectorAll(
              "[data-scroll-area-inner], [data-panel-body]",
            ),
          ];
          let need = 0;
          for (const n of nodes) {
            if (n) need = Math.max(need, n.scrollHeight - n.clientHeight);
          }
          if (need <= 1) break;
          el.style.height = `${el.clientHeight + need}px`;
          void el.offsetHeight;
        }
      });
      await page.evaluate(
        () =>
          new Promise<void>((res) => {
            requestAnimationFrame(() => requestAnimationFrame(() => res()));
          }),
      );
      await page.waitForTimeout(150);

      const root = await page.$("#root");
      if (!root) throw new Error("Crew-avatar probe: #root missing");
      const outName = `crew-status-avatar-crew-critical-${mode.name}.png`;
      await root.screenshot({ path: join(OUT_DIR, outName) });
      console.log(`  ${outName}`);

      await context.close();
    }
    console.log(`\nRendered crew-status avatar layout -> ${OUT_DIR}`);
  } finally {
    await browser.close();
  }
}

/** Verbatim copy of `render-crew-status-panel-badge.ts`'s own helper. */
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
