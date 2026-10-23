#!/usr/bin/env tsx
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build, type Plugin } from "esbuild";
import { chromium } from "playwright";
/**
 * Mounts the Graph settings form at a phone station's width with a coarse
 * pointer, screenshots it, and fails when a control is under 44 px in either
 * direction, when a label is under 14 px, or when the page scrolls sideways.
 *
 * Run via
 * `pnpm --filter @ksp-gonogo/components exec tsx scripts/render-graph-config-phone.ts [--out <dir>] [--name <prefix>]`.
 */
import { makeTempDir } from "../../../scripts/temp-dir.mjs";
import { jetbrainsMonoFontFace } from "./jetbrainsMonoFontFace";

const require = createRequire(import.meta.url);
const HERE = dirname(fileURLToPath(import.meta.url));
const ENTRY = resolve(HERE, "graph-config-probe/entry.tsx");
const THEME_TOKENS_CSS = resolve(HERE, "../../theme/src/tokens.css");
const PHONE_WIDTH = 390;
const MIN_TOUCH_PX = 44;
const MIN_TEXT_PX = 14;

function flag(name: string): string | undefined {
  const at = process.argv.indexOf(name);
  return at === -1 ? undefined : process.argv[at + 1];
}

/* Resolves `.css` imports through Node, as `widgetRenderHarness.ts` does, since esbuild's own resolve would re-enter this filter. */
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
        contents: `const __style = document.createElement("style");
__style.textContent = ${JSON.stringify(css)};
document.head.appendChild(__style);`,
      };
    });
  },
};

interface Finding {
  what: string;
  w: number;
  h: number;
  fontPx: number;
}

async function main(): Promise<void> {
  const outDir = resolve(
    flag("--out") ??
      join(HERE, "../../../local_docs/renders/graph-config-phone"),
  );
  const prefix = flag("--name") ?? "graph-config";
  await mkdir(outDir, { recursive: true });

  const bundle = await build({
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
  const script = bundle.outputFiles[0].text.replace(
    /<\/script/gi,
    "<\\/script",
  );
  const theme = await readFile(THEME_TOKENS_CSS, "utf8");
  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Graph config phone probe</title>
    <style>${await jetbrainsMonoFontFace()}${theme}</style>
    <style>
      html, body { margin: 0; background: var(--color-surface-app); color: var(--color-text-primary); font-family: var(--font-family-mono); }
      #root { padding: 16px; }
    </style>
  </head>
  <body>
    <div id="root"></div>
    <script type="module">${script}</script>
  </body>
</html>`;
  const file = join(
    makeTempDir("gonogo-probe-"),
    `graph-config-${process.pid}.html`,
  );
  await writeFile(file, html, "utf8");

  const browser = await chromium.launch();
  const findings: Finding[] = [];
  let scrollsSideways = false;
  try {
    const context = await browser.newContext({
      viewport: { width: PHONE_WIDTH, height: 1300 },
      deviceScaleFactor: 2,
      hasTouch: true,
      isMobile: true,
      reducedMotion: "reduce",
    });
    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    await cdp.send("Emulation.setEmitTouchEventsForMouse", {
      enabled: true,
      configuration: "mobile",
    });
    page.on("pageerror", (err) => console.error("  [page error]", err.message));
    await page.goto(pathToFileURL(file).toString(), {
      waitUntil: "domcontentloaded",
    });
    await page.waitForFunction(
      () =>
        typeof (window as unknown as { __renderGraphConfig?: unknown })
          .__renderGraphConfig === "function",
      undefined,
      { timeout: 10_000 },
    );
    await page.evaluate(() =>
      (
        window as unknown as { __renderGraphConfig: () => Promise<void> }
      ).__renderGraphConfig(),
    );

    const coarse = await page.evaluate(
      () => matchMedia("(pointer: coarse)").matches,
    );
    if (!coarse)
      throw new Error("the browser did not emulate a coarse pointer");
    const measured = await page.evaluate(() => {
      const controls = Array.from(
        document.querySelectorAll<HTMLElement>(
          "#root input, #root select, #root button",
        ),
      );
      return {
        scrolls:
          document.documentElement.scrollWidth >
          document.documentElement.clientWidth,
        controls: controls.map((el) => {
          const r = el.getBoundingClientRect();
          return {
            what:
              el.getAttribute("aria-label") ??
              el.getAttribute("placeholder") ??
              el.textContent?.trim() ??
              el.tagName.toLowerCase(),
            w: Math.round(r.width),
            h: Math.round(r.height),
            fontPx: Number.parseFloat(getComputedStyle(el).fontSize),
          };
        }),
      };
    });
    scrollsSideways = measured.scrolls;
    findings.push(...measured.controls);
    await page.screenshot({
      path: join(outDir, `${prefix}-390.png`),
      animations: "disabled",
    });
    await context.close();
  } finally {
    await browser.close();
  }

  const failures: string[] = [];
  if (scrollsSideways) failures.push("page scrolls sideways at 390 px");
  for (const c of findings) {
    if (c.h < MIN_TOUCH_PX || c.w < MIN_TOUCH_PX) {
      failures.push(`"${c.what}" is ${c.w}x${c.h}, under ${MIN_TOUCH_PX}`);
    }
    if (c.fontPx < MIN_TEXT_PX) {
      failures.push(`"${c.what}" text is ${c.fontPx}px, under ${MIN_TEXT_PX}`);
    }
  }
  console.log(`${findings.length} controls measured → ${outDir}`);
  if (failures.length > 0) {
    console.error(`FAIL\n  ${failures.join("\n  ")}`);
    process.exit(1);
  }
  console.log("PASS");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
