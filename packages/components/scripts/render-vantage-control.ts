#!/usr/bin/env tsx
/**
 * One-off review-render driver for `MissionBanner`'s `VantageControl` (the
 * command-vantage selector in the app header). Not part of the widget/screen
 * registries in `widgets.ts`: this is app chrome, not a registered dashboard
 * widget or a routed screen, so it gets its own small esbuild + Playwright
 * pipeline rather than a config entry in the shared harness.
 *
 * Renders three states into `local_docs/renders/vantage-control/`:
 *   - `resting-home-only`   : one active centre (KSC), collapsed
 *   - `resting-multi`       : two active centres, collapsed
 *   - `open-multi`          : two active centres, dropdown expanded
 *
 * Run via `pnpm --filter @ksp-gonogo/components exec tsx scripts/render-vantage-control.ts`.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build, type Plugin } from "esbuild";
import { chromium } from "playwright";

const require = createRequire(import.meta.url);
const HERE = dirname(fileURLToPath(import.meta.url));
const ENTRY = resolve(HERE, "vantage-control-probe/entry.tsx");
const OUT_DIR = resolve(HERE, "../../../local_docs/renders/vantage-control");
const THEME_TOKENS_CSS = resolve(HERE, "../../theme/src/tokens.css");

// Same recursion hazard `widgetRenderHarness.ts` documents: resolve `.css`
// imports via Node's own resolver rather than esbuild's `resolve()`, which
// would re-enter this same onResolve filter.
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

function extractRootBlock(css: string): string {
  const match = css.match(/:root\s*\{[\s\S]*?\}/);
  if (!match) throw new Error("tokens.css: no :root block found");
  return match[0];
}

/** Inline JetBrains Mono as a data-URI @font-face, matching every other
 *  probe render's deterministic font. */
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

interface VantageState {
  name: string;
  roster?: unknown[];
  open?: boolean;
}

const STATES: VantageState[] = [
  {
    name: "resting-home-only",
    roster: [
      { id: "ksc", displayName: "KSC", kind: "GroundStation", active: true },
    ],
  },
  {
    name: "resting-multi",
    roster: [
      { id: "ksc", displayName: "KSC", kind: "GroundStation", active: true },
      {
        id: "ground:gs1",
        displayName: "Woomera Station",
        kind: "GroundStation",
        active: true,
      },
    ],
  },
  {
    name: "open-multi",
    roster: [
      { id: "ksc", displayName: "KSC", kind: "GroundStation", active: true },
      {
        id: "ground:gs1",
        displayName: "Woomera Station",
        kind: "GroundStation",
        active: true,
      },
    ],
    open: true,
  },
];

async function main(): Promise<void> {
  await mkdir(OUT_DIR, { recursive: true });

  console.log(`Bundling ${ENTRY} with esbuild…`);
  const bundleResult = await build({
    entryPoints: [ENTRY],
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
  const escapedBundle = bundleJs.replace(/<\/script/gi, "<\\/script");

  const themeCss = extractRootBlock(await readFile(THEME_TOKENS_CSS, "utf8"));
  const fontFace = await jetbrainsMonoFontFace();

  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Vantage control probe</title>
    <style id="probe-theme">${fontFace}${themeCss}</style>
    <style>
      html, body {
        margin: 0;
        padding: 24px;
        background: var(--color-surface-app);
        color: var(--color-text-primary);
        font-family: var(--font-family-mono);
      }
      #root { display: inline-block; }
    </style>
  </head>
  <body>
    <div id="root"></div>
    <script type="module">${escapedBundle}</script>
  </body>
</html>`;

  const probeHtmlOut = join(
    tmpdir(),
    `gonogo-vantage-probe-${process.pid}.html`,
  );
  await writeFile(probeHtmlOut, html, "utf8");
  const probeUrl = pathToFileURL(probeHtmlOut).toString();

  console.log("Launching Chromium…");
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({
      viewport: { width: 420, height: 200 },
      deviceScaleFactor: 2,
      reducedMotion: "reduce",
    });
    const page = await context.newPage();
    page.on("pageerror", (err) => console.error("  [page error]", err.message));
    page.on("console", (msg) => {
      if (msg.type() === "error")
        console.error("  [console error]", msg.text());
    });

    await page.goto(probeUrl, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(
      () =>
        typeof (window as unknown as { __renderVantage?: unknown })
          .__renderVantage === "function",
      undefined,
      { timeout: 10_000 },
    );

    for (const state of STATES) {
      await page.evaluate(
        (p) =>
          (
            window as unknown as {
              __renderVantage: (payload: unknown) => Promise<void>;
            }
          ).__renderVantage(p),
        { roster: state.roster, open: state.open },
      );
      const outPath = join(OUT_DIR, `${state.name}.png`);
      // Full viewport, not `#root`'s own box: the open dropdown is an
      // absolutely-positioned child that overflows #root's own inline-block
      // bounding rect, an element-scoped screenshot would clip it off.
      await page.screenshot({
        path: outPath,
        animations: "disabled",
      });
      console.log(`  ${state.name} → ${outPath}`);
    }
    await context.close();
  } finally {
    await browser.close();
  }
  console.log(`\nRendered ${STATES.length} vantage-control shots → ${OUT_DIR}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
