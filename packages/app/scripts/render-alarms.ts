#!/usr/bin/env tsx
/**
 * Render the alarm surface through a real Chromium page, at two light-times.
 *
 * Run: `pnpm --filter @ksp-gonogo/app render-alarms`
 * Output: local_docs/renders/alarms/ (ALARMS_RENDER_OUT overrides, which is
 * what a worktree wants: its own local_docs goes with it when it is pruned, and
 * a reviewer needs the shots at the path they were given).
 *
 * Two scenes, and the pair is the point. The same modal with the same alarms
 * renders every instant bare on a LAN session and qualified (`SCET`,
 * `AT KSC`) at four light-minutes. Whether that qualifier reads as information
 * or as clutter is a question about pixels, and a test that asserts the string
 * is present cannot answer it.
 */
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";
import { chromium } from "playwright";

const HERE = dirname(fileURLToPath(import.meta.url));
const PROBE_DIR = resolve(HERE, "probe");
const PROBE_ENTRY = join(PROBE_DIR, "alarms-probe-entry.tsx");
const PROBE_HTML = join(PROBE_DIR, "alarms-probe.html");

/**
 * The theme package's SOURCE tokens.css. `global.css` only `@import`s it now,
 * so a driver pointing at that file finds no `:root` to extract and every
 * probe renders unthemed.
 */
const THEME_TOKENS_CSS = resolve(HERE, "../../theme/src/tokens.css");

const OUT_DIR =
  process.env.ALARMS_RENDER_OUT ??
  resolve(HERE, "../../../local_docs/renders/alarms");

interface Scene {
  name: string;
  delaySeconds: number;
  pxW: number;
  pxH: number;
}

const SCENES: Scene[] = [
  {
    // No delay in force: one clock, so nothing is qualified and the surface
    // looks exactly as it always has. This is the control, and it is here to
    // prove the qualifier below is a consequence of the light-time rather than
    // a label the component always draws.
    name: "alarms-lan",
    delaySeconds: 0,
    pxW: 900,
    pxH: 620,
  },
  {
    // Four light-minutes, roughly Duna at a good conjunction. The apsis preset
    // states a SCET, the scheduled alarm states the arrival clock it fires on,
    // and the fired event states when it actually happened.
    name: "alarms-delayed",
    delaySeconds: 240,
    pxW: 900,
    pxH: 620,
  },
];

/** The theme sheet whole, checked to be the tokens file. The border-box reset
 *  the kit's primitives are drawn against sits outside the `:root` block. */
function themeCss(css: string): string {
  if (!/:root\s*\{/.test(css)) {
    throw new Error("tokens.css: no :root block found");
  }
  return css;
}

async function prepareProbePage(): Promise<string> {
  console.log("Bundling alarms probe with esbuild...");
  const result = await build({
    entryPoints: [PROBE_ENTRY],
    bundle: true,
    format: "esm",
    target: "es2022",
    platform: "browser",
    jsx: "automatic",
    write: false,
    sourcemap: "inline",
    define: {
      "process.env.NODE_ENV": '"production"',
      "import.meta.env.DEV": "false",
      "import.meta.env.PROD": "true",
      "import.meta.env.MODE": '"production"',
    },
    loader: { ".css": "text", ".svg": "dataurl", ".png": "dataurl" },
  });
  const bundleJs = result.outputFiles[0].text;
  const html = await readFile(PROBE_HTML, "utf8");
  const theme = themeCss(await readFile(THEME_TOKENS_CSS, "utf8"));
  const escaped = bundleJs.replace(/<\/script/gi, "<\\/script");
  const out = html
    .replace(
      '<style id="probe-theme">/* injected by the render driver from packages/theme/src/tokens.css */</style>',
      () => `<style id="probe-theme">${theme}</style>`,
    )
    .replace(
      '<script type="module" src="./alarms-probe-entry.bundle.js"></script>',
      () => `<script type="module">${escaped}</script>`,
    );
  const file = join(tmpdir(), `alarms-probe-${process.pid}.html`);
  await writeFile(file, out, "utf8");
  return file;
}

async function cleanRenders(dir: string): Promise<void> {
  let entries: string[] = [];
  try {
    entries = await readdir(dir);
  } catch {
    return;
  }
  for (const e of entries) {
    if (e.endsWith(".png")) await rm(join(dir, e));
  }
}

async function main(): Promise<void> {
  const probeHtml = await prepareProbePage();
  await mkdir(OUT_DIR, { recursive: true });
  await cleanRenders(OUT_DIR);

  console.log("Launching Chromium...");
  const browser = await chromium.launch();
  let failures = 0;
  try {
    const context = await browser.newContext({
      viewport: { width: 960, height: 1400 },
      deviceScaleFactor: 2,
    });
    const page = await context.newPage();
    page.on("pageerror", (err) => {
      failures++;
      console.error("  [page error]", err.message);
    });
    page.on("console", (msg) => {
      if (msg.type() === "error") console.error("  [console]", msg.text());
    });

    await page.goto(pathToFileURL(probeHtml).toString(), {
      waitUntil: "domcontentloaded",
    });
    await page.waitForFunction(
      () =>
        typeof (window as unknown as { __renderAlarms?: unknown })
          .__renderAlarms === "function",
      undefined,
      { timeout: 15_000 },
    );

    for (const { name, delaySeconds, pxW, pxH } of SCENES) {
      await page.evaluate(
        (s) =>
          (
            window as unknown as {
              __renderAlarms: (p: unknown) => Promise<void>;
            }
          ).__renderAlarms(s),
        { delaySeconds, pxW, pxH },
      );
      /*
       * The presets sit behind a collapsed caret, and they are half of what
       * this render is for. WAITED FOR rather than probed: the derived
       * `vessel.state` the apsis preset reads settles a frame or two after the
       * orbit lands, and a fixed sleep plus a `count() > 0` check silently
       * rendered the FIRST scene without a Recommended section at all. The two
       * scenes then differed by something other than the light-time, which is
       * the one thing the pair exists to isolate.
       */
      const recommended = page.getByRole("button", { name: /recommended/i });
      await recommended.first().waitFor({ state: "visible", timeout: 10_000 });
      await recommended.first().click();
      await page.waitForTimeout(150);
      const root = await page.$("#root");
      if (!root) throw new Error("#root missing after render");
      const out = join(OUT_DIR, `${name}.png`);
      await root.screenshot({ path: out });
      console.log(`  ✓ ${name} → ${out}`);
    }
  } finally {
    await browser.close();
  }

  // A page error means a scene rendered wrong, and a silently wrong render is
  // worse than no render: it goes to a reviewer looking like the real thing.
  if (failures > 0) {
    throw new Error(`${failures} page error(s) during rendering; see above`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
