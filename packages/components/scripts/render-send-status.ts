#!/usr/bin/env tsx
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";
import { chromium } from "playwright";
/**
 * Render one command control in each send-status state, and the same control
 * without a status, to PNGs. `--out <dir>` picks the folder. Model copied from
 * `render-delay-rail.ts`: esbuild bundle, injected theme, playwright shot.
 */
import { makeTempDir } from "../../../scripts/temp-dir.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const PROBE_DIR = resolve(HERE, "send-status-probe");
const THEME_TOKENS_CSS = resolve(HERE, "../../theme/src/tokens.css");

const outFlag = process.argv.indexOf("--out");
const OUT_DIR = resolve(
  outFlag === -1
    ? resolve(HERE, "../../../.renders/send-status")
    : process.argv[outFlag + 1],
);

const WIDTH = 360;
const HEIGHT = 200;

const STATES = ["before", "now", "held", "loss", "none"] as const;

async function main(): Promise<void> {
  await mkdir(OUT_DIR, { recursive: true });
  const bundle = await build({
    entryPoints: [join(PROBE_DIR, "send-status-probe-entry.tsx")],
    bundle: true,
    format: "esm",
    target: "es2022",
    platform: "browser",
    jsx: "automatic",
    write: false,
    define: { "process.env.NODE_ENV": '"production"' },
    loader: { ".css": "text" },
  });
  const html = (
    await readFile(join(PROBE_DIR, "send-status-probe.html"), "utf8")
  )
    .replace(
      '<style id="probe-theme">/* injected by render-send-status driver from packages/theme/src/tokens.css */</style>',
      () => `<style id="probe-theme">${readThemeSync()}</style>`,
    )
    .replace(
      '<script type="module" src="./send-status-probe-entry.bundle.js"></script>',
      () =>
        `<script type="module">${bundle.outputFiles[0].text.replace(/<\/script/gi, "<\\/script")}</script>`,
    );
  const file = join(
    makeTempDir("gonogo-probe-"),
    `gonogo-send-status-probe-${process.pid}.html`,
  );
  await writeFile(file, html, "utf8");

  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({
      viewport: { width: WIDTH, height: HEIGHT },
      deviceScaleFactor: 2,
      reducedMotion: "reduce",
    });
    const page = await context.newPage();
    page.on("pageerror", (err) => console.error("  [page error]", err.message));
    await page.goto(pathToFileURL(file).toString(), {
      waitUntil: "domcontentloaded",
    });
    await page.waitForFunction(
      () =>
        typeof (window as unknown as { __renderSendStatus?: unknown })
          .__renderSendStatus === "function",
    );
    const mount = (payload: unknown) =>
      page.evaluate(
        (p) =>
          (
            window as unknown as {
              __renderSendStatus: (p: unknown) => Promise<void>;
            }
          ).__renderSendStatus(p),
        payload,
      );

    /* A control occupies the same box in every state: the button's size and where its two neighbours sit. */
    const boxes: Record<string, unknown> = {};
    for (const state of STATES) {
      await mount({ layout: "single", state, pxW: WIDTH, pxH: HEIGHT });
      boxes[state] = await page.evaluate(() =>
        [...document.querySelectorAll("button")].map((b) => {
          const r = b.getBoundingClientRect();
          return [r.x, r.y, r.width, r.height];
        }),
      );
    }
    const reference = JSON.stringify(boxes.before);
    for (const state of STATES) {
      if (JSON.stringify(boxes[state]) !== reference) {
        throw new Error(
          `layout changed in state ${state}: ${JSON.stringify(boxes[state])} vs ${reference}`,
        );
      }
    }
    console.log("  layout identical across before, now, held, loss, none");

    for (const layout of ["states", "widget"] as const) {
      const pxH = layout === "widget" ? 260 : HEIGHT;
      await page.setViewportSize({ width: WIDTH, height: pxH });
      await mount({ layout, pxW: WIDTH, pxH });
      await page.mouse.move(WIDTH - 2, pxH - 2);
      await page.waitForTimeout(600);
      await page.screenshot({ path: join(OUT_DIR, `${layout}-plain.png`) });
      console.log(`  ${layout}-plain.png`);
      for (const [name, label] of [
        ["now", "Sends now"],
        ["held", "Held"],
        ["loss", "LOS"],
        ["none", "No route"],
      ] as const) {
        await page.getByRole("button", { name: label }).hover();
        await page.waitForTimeout(500);
        await page.screenshot({
          path: join(OUT_DIR, `${layout}-hover-${name}.png`),
        });
        await page.mouse.move(WIDTH - 2, pxH - 2);
        await page.waitForTimeout(600);
      }
      /* Keyboard focus on each in turn, with the tooltip closed by moving the pointer away first. */
      await page.keyboard.press("Tab");
      for (const name of ["now", "held", "loss", "none"]) {
        await page.waitForTimeout(300);
        await page.screenshot({
          path: join(OUT_DIR, `${layout}-focus-${name}.png`),
        });
        await page.keyboard.press("Tab");
      }
      console.log(`  ${layout}-hover-* and ${layout}-focus-*`);
    }
  } finally {
    await browser.close();
  }
}

function readThemeSync(): string {
  return themeCssText;
}
let themeCssText = "";

readFile(THEME_TOKENS_CSS, "utf8")
  .then((css) => {
    themeCssText = css;
    return main();
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
