#!/usr/bin/env tsx
/**
 * Review-render driver for the "Fires on" vantage control in `AlarmsModal`:
 * the SCET / Received toggle an operator picks a new alarm's clock with.
 *
 * Two shots per trigger kind, because the question the renders answer is
 * whether the control reads as available:
 *   - `<kind>-control` : the control's own field, label, radios and hints
 *   - `<kind>-form`    : the top of the draft form, so the kind it belongs to is in frame
 *
 * Output goes wherever `--out` says, defaulting to `local_docs/renders/alarms-vantage`.
 *
 * Run via
 * `pnpm --filter @ksp-gonogo/components exec tsx scripts/render-alarms-vantage.ts [--out <dir>]`.
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
const ENTRY = resolve(HERE, "alarms-modal-probe/entry.tsx");
const THEME_TOKENS_CSS = resolve(HERE, "../../theme/src/tokens.css");

function outDir(): string {
  const flag = process.argv.indexOf("--out");
  if (flag !== -1 && process.argv[flag + 1] !== undefined) {
    return resolve(process.argv[flag + 1]);
  }
  return resolve(HERE, "../../../local_docs/renders/alarms-vantage");
}

/* Same recursion hazard `widgetRenderHarness.ts` documents: resolve `.css`
   imports through Node's own resolver rather than esbuild's `resolve()`, which
   would re-enter this same onResolve filter. */
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

/** The theme sheet whole, checked to be the tokens file. */
function themeCss(css: string): string {
  if (!/:root\s*\{/.test(css)) {
    throw new Error("tokens.css: no :root block found");
  }
  return css;
}

/** JetBrains Mono inlined as data URIs, matching every other probe render's font. */
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

const KINDS = ["time", "threshold"] as const;

async function main(): Promise<void> {
  const OUT_DIR = outDir();
  await mkdir(OUT_DIR, { recursive: true });

  console.log(`Bundling ${ENTRY} with esbuild...`);
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

  const theme = themeCss(await readFile(THEME_TOKENS_CSS, "utf8"));
  const fontFace = await jetbrainsMonoFontFace();

  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Alarms vantage probe</title>
    <style id="probe-theme">${fontFace}${theme}</style>
    <style>
      html, body {
        margin: 0;
        padding: 24px;
        background: var(--color-surface-app);
        color: var(--color-text-primary);
        font-family: var(--font-family-mono);
      }
    </style>
  </head>
  <body>
    <div id="root"></div>
    <script type="module">${escapedBundle}</script>
  </body>
</html>`;

  const probeHtmlOut = join(
    tmpdir(),
    `gonogo-alarms-probe-${process.pid}.html`,
  );
  await writeFile(probeHtmlOut, html, "utf8");
  const probeUrl = pathToFileURL(probeHtmlOut).toString();

  console.log("Launching Chromium...");
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({
      viewport: { width: 860, height: 700 },
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
        typeof (window as unknown as { __renderAlarms?: unknown })
          .__renderAlarms === "function",
      undefined,
      { timeout: 10_000 },
    );

    for (const kind of KINDS) {
      await page.evaluate(
        (p) =>
          (
            window as unknown as {
              __renderAlarms: (payload: unknown) => Promise<void>;
            }
          ).__renderAlarms(p),
        { kind },
      );

      // The control's own field: the label the radiogroup names, the two
      // radios, and the hints under them.
      const field = page.locator("#alarm-vantage-label").locator("..");
      const controlPath = join(OUT_DIR, `${kind}-control.png`);
      await field.screenshot({ path: controlPath, animations: "disabled" });
      console.log(`  ${kind}-control → ${controlPath}`);

      // The top of the draft form, so which kind the control belongs to is
      // legible in the same frame.
      const formPath = join(OUT_DIR, `${kind}-form.png`);
      await page.screenshot({
        path: formPath,
        animations: "disabled",
        clip: { x: 0, y: 0, width: 860, height: 560 },
      });
      console.log(`  ${kind}-form → ${formPath}`);
    }
    await context.close();
  } finally {
    await browser.close();
  }
  console.log(
    `\nRendered ${KINDS.length * 2} alarm-vantage shots → ${OUT_DIR}`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
