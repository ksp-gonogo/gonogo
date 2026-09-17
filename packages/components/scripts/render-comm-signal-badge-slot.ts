#!/usr/bin/env tsx
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build, type Plugin } from "esbuild";
import { chromium } from "playwright";
import type { CommSignalBadgeProbePayload } from "./comm-signal-badge-probe/comm-signal-badge-probe-entry";

const require = createRequire(import.meta.url);

const HERE = dirname(fileURLToPath(import.meta.url));
const PROBE_DIR = resolve(HERE, "comm-signal-badge-probe");
const PROBE_ENTRY = join(PROBE_DIR, "comm-signal-badge-probe-entry.tsx");
const PROBE_HTML_TEMPLATE = join(PROBE_DIR, "comm-signal-badge-probe.html");
const OUT_DIR = join(
  homedir(),
  ".claude/inbox/gonogo/renders/commsignal-badge-slot",
);
const THEME_TOKENS_CSS = resolve(HERE, "../../theme/src/tokens.css");
const FIXTURE_PATH = resolve(
  HERE,
  "../src/CommSignal/__fixtures__/strong-direct-ksc.json",
);

const COL_WIDTH = 32;
const ROW_HEIGHT = 25;
const GRID_MARGIN = 8;
function gridPx(w: number, h: number): { pxW: number; pxH: number } {
  return {
    pxW: w * COL_WIDTH + (w - 1) * GRID_MARGIN,
    pxH: h * ROW_HEIGHT + (h - 1) * GRID_MARGIN,
  };
}

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

interface Shot {
  name: string;
  w: number;
  h: number;
  disconnect: boolean;
}

const SHOTS: Shot[] = [
  { name: "no-signal-8x8", w: 8, h: 8, disconnect: true },
  { name: "no-signal-6x5", w: 6, h: 5, disconnect: true },
  { name: "no-signal-min-3x3", w: 3, h: 3, disconnect: true },
  { name: "healthy-8x8", w: 8, h: 8, disconnect: false },
  { name: "healthy-6x5", w: 6, h: 5, disconnect: false },
];

async function main(): Promise<void> {
  await mkdir(OUT_DIR, { recursive: true });

  const fixture: FixtureFile = JSON.parse(await readFile(FIXTURE_PATH, "utf8"));

  console.log("Bundling comm-signal-badge-probe-entry with esbuild...");
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
      '<script type="module" src="./comm-signal-badge-probe-entry.bundle.js"></script>',
      () => `<script type="module">${escapedBundle}</script>`,
    );

  const probeHtmlOut = join(
    tmpdir(),
    `gonogo-comm-signal-badge-probe-${process.pid}.html`,
  );
  await writeFile(probeHtmlOut, htmlWithBundle, "utf8");

  console.log("Launching Chromium...");
  const browser = await chromium.launch();
  try {
    for (const shot of SHOTS) {
      const { pxW, pxH } = gridPx(shot.w, shot.h);
      const context = await browser.newContext({
        viewport: { width: pxW + 80, height: pxH + 120 },
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
            window as unknown as { __renderCommSignalBadgeProbe?: unknown }
          ).__renderCommSignalBadgeProbe === "function",
        undefined,
        { timeout: 10_000 },
      );

      const payload: CommSignalBadgeProbePayload = {
        carriedChannels: fixture._stream.carriedChannels,
        pinnedUt: fixture._stream.pinnedUt,
        emits: fixture._stream.emits,
        disconnect: shot.disconnect,
        w: shot.w,
        h: shot.h,
        pxW,
        pxH,
      };

      await page.evaluate(
        (p) =>
          (
            window as unknown as {
              __renderCommSignalBadgeProbe: (
                payload: typeof p,
              ) => Promise<void>;
            }
          ).__renderCommSignalBadgeProbe(p),
        payload,
      );
      const outName = `${shot.name}.png`;
      await page.screenshot({ path: join(OUT_DIR, outName), fullPage: false });
      console.log(`  ${outName}`);
      await context.close();
    }
    console.log(`\nRendered CommSignal badge slot -> ${OUT_DIR}`);
  } finally {
    await browser.close();
  }
}

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

function themeCss(css: string): string {
  if (!/:root\s*\{/.test(css)) {
    throw new Error("tokens.css: no :root block found");
  }
  return css;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
