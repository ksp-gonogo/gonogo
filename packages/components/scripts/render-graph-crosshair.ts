#!/usr/bin/env tsx
/**
 * Render the three states a trace can be in, at every fixture in
 * `scripts/graph-crosshair-probe/__fixtures__/`, to a PNG under
 * `local_docs/renders/reckoning/`.
 *
 * Uses a dedicated probe rather than the widget-fixture harness, for a reason
 * that is the point of the renders: the reckoned state has NO PRODUCER on the
 * stream, so no telemetry fixture can drive it. `LineChart` is presentational
 * (arrays in, SVG out), so it mounts here with explicit props and the picture
 * shows the presentation the moment a model exists to fill it.
 */
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";
import { chromium } from "playwright";

const HERE = dirname(fileURLToPath(import.meta.url));
const PROBE_DIR = resolve(HERE, "graph-crosshair-probe");
const PROBE_ENTRY = join(PROBE_DIR, "graph-crosshair-probe-entry.tsx");
const PROBE_HTML_TEMPLATE = join(PROBE_DIR, "graph-crosshair-probe.html");
const OUT_DIR = join(homedir(), ".claude/inbox/gonogo/renders/graph879");
/*
 * The theme package's SOURCE tokens.css: plain text, no bundler resolution,
 * and no dependency on `@ksp-gonogo/theme` having been built.
 */
const THEME_TOKENS_CSS = resolve(HERE, "../../theme/src/tokens.css");
const UI_SRC = resolve(HERE, "../../ui/src");
const UI_DIST_ENTRY = resolve(HERE, "../../ui/dist/index.js");

const PADDING = 24;

const SIZES = [
  { name: "default", w: 420, h: 260 },
  { name: "wide", w: 760, h: 260 },
  { name: "tiny", w: 200, h: 120 },
];
/** Fractions of the plot width the pointer visits. */
const STOPS = [0.2, 0.55, 0.9];

async function main(): Promise<void> {
  await assertUiDistIsCurrent();
  const outDir = process.argv[2] ?? OUT_DIR;
  await mkdir(outDir, { recursive: true });

  const bundle = (
    await build({
      entryPoints: [PROBE_ENTRY],
      bundle: true,
      format: "esm",
      target: "es2022",
      platform: "browser",
      jsx: "automatic",
      write: false,
      define: { "process.env.NODE_ENV": '"production"' },
      loader: { ".css": "text" },
    })
  ).outputFiles[0].text.replace(/<\/script/gi, "<\\/script");
  const theme = themeCss(await readFile(THEME_TOKENS_CSS, "utf8"));
  const html = (await readFile(PROBE_HTML_TEMPLATE, "utf8"))
    .replace(
      '<style id="probe-theme">/* injected by render-graph-crosshair driver from packages/theme/src/tokens.css */</style>',
      () => `<style id="probe-theme">${theme}</style>`,
    )
    .replace(
      '<script type="module" src="./graph-crosshair-probe-entry.bundle.js"></script>',
      () => `<script type="module">${bundle}</script>`,
    );
  const probe = join(
    tmpdir(),
    `gonogo-graph-crosshair-probe-${process.pid}.html`,
  );
  await writeFile(probe, html, "utf8");

  const browser = await chromium.launch();
  try {
    for (const size of SIZES) {
      for (const crosshair of [false, true]) {
        const context = await browser.newContext({
          viewport: {
            width: size.w + PADDING * 2,
            height: size.h + PADDING * 2,
          },
          deviceScaleFactor: 2,
        });
        const page = await context.newPage();
        page.on("pageerror", (err) =>
          console.error("  [page error]", err.message),
        );
        await page.goto(pathToFileURL(probe).toString(), {
          waitUntil: "domcontentloaded",
        });
        await page.waitForFunction(
          () =>
            typeof (window as unknown as { __renderGraphCrosshair?: unknown })
              .__renderGraphCrosshair === "function",
        );
        await page.evaluate(
          (p) =>
            (
              window as unknown as {
                __renderGraphCrosshair: (q: unknown) => Promise<void>;
              }
            ).__renderGraphCrosshair(p),
          { crosshair, pxW: size.w, pxH: size.h },
        );
        const prefix = `${crosshair ? "after" : "before"}-${size.name}`;
        const box = await page.locator("#root svg").boundingBox();
        if (!box) throw new Error("no chart");
        const plot = await page.evaluate(() => {
          const rect = document.querySelector("#root svg rect");
          return {
            x: Number(rect?.getAttribute("x")),
            width: Number(rect?.getAttribute("width")),
          };
        });
        const left = box.x + plot.x;
        const span = plot.width;
        for (const [i, stop] of STOPS.entries()) {
          await page.mouse.move(left + span * stop, box.y + box.height / 2);
          await page.screenshot({
            path: join(outDir, `${prefix}-hover-${i + 1}.png`),
          });
          console.log(`  ${prefix}-hover-${i + 1}.png`);
        }
        if (crosshair) {
          await page.mouse.move(2, 2);
          await page.keyboard.press("Tab");
          for (let k = 0; k < 8; k++) await page.keyboard.press("ArrowLeft");
          await page.screenshot({
            path: join(outDir, `${prefix}-keyboard-focus.png`),
          });
          console.log(`  ${prefix}-keyboard-focus.png`);
        }
        await context.close();
      }
    }
  } finally {
    await browser.close();
  }
}

/**
 * Refuse to render against a `@ksp-gonogo/ui` build older than its own source.
 *
 * `packages/ui` resolves through `dist`, and esbuild bundles whatever is there
 * without a word. The first run of this driver produced a picture of the
 * PREVIOUS chart's rules and looked entirely plausible, which is the failure
 * mode a render is least able to show you: a shot that predates the change it
 * is offered as evidence of. Cheap to detect, so detected.
 */
async function assertUiDistIsCurrent(): Promise<void> {
  const dist = await stat(UI_DIST_ENTRY).catch(() => null);
  if (!dist) {
    throw new Error(
      "packages/ui is not built. Run `pnpm --filter @ksp-gonogo/ui build` first.",
    );
  }
  const newest = await newestMtime(UI_SRC);
  if (newest > dist.mtimeMs) {
    throw new Error(
      "packages/ui/dist is older than packages/ui/src: the render would show " +
        "the previous chart. Run `pnpm --filter @ksp-gonogo/ui build` first.",
    );
  }
}

async function newestMtime(dir: string): Promise<number> {
  let newest = 0;
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    newest = Math.max(
      newest,
      e.isDirectory() ? await newestMtime(p) : (await stat(p)).mtimeMs,
    );
  }
  return newest;
}

/** The theme sheet whole, checked to be the tokens file. */
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
