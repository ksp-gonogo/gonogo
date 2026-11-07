#!/usr/bin/env tsx
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";
import { chromium } from "playwright";
/**
 * Render the faces a command input draws (toggle, icon toggle, button) at rest
 * and in each phase, to one PNG. `--out <dir>` picks the folder. Model copied
 * from `render-send-status.ts`.
 */
import { makeTempDir } from "../../../scripts/temp-dir.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const PROBE_DIR = resolve(HERE, "command-inputs-probe");
const THEME_TOKENS_CSS = resolve(HERE, "../../theme/src/tokens.css");

const outFlag = process.argv.indexOf("--out");
const OUT_DIR = resolve(
  outFlag === -1
    ? resolve(HERE, "../../../.renders/command-inputs")
    : process.argv[outFlag + 1],
);

const WIDTH = 1400;

async function main(theme: string): Promise<void> {
  await mkdir(OUT_DIR, { recursive: true });
  const bundle = await build({
    entryPoints: [join(PROBE_DIR, "command-inputs-probe-entry.tsx")],
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
    await readFile(join(PROBE_DIR, "command-inputs-probe.html"), "utf8")
  )
    .replace(
      '<style id="probe-theme">/* injected by render-command-inputs driver from packages/theme/src/tokens.css */</style>',
      () => `<style id="probe-theme">${theme}</style>`,
    )
    .replace(
      '<script type="module" src="./command-inputs-probe-entry.bundle.js"></script>',
      () =>
        `<script type="module">${bundle.outputFiles[0].text.replace(/<\/script/gi, "<\\/script")}</script>`,
    );
  const file = join(
    makeTempDir("gonogo-probe-"),
    `gonogo-command-inputs-${process.pid}.html`,
  );
  await writeFile(file, html, "utf8");
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({
      viewport: { width: WIDTH + 40, height: 760 },
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
        typeof (window as unknown as { __renderCommandInputs?: unknown })
          .__renderCommandInputs === "function",
    );
    await page.evaluate(
      (p) =>
        (
          window as unknown as {
            __renderCommandInputs: (p: unknown) => Promise<void>;
          }
        ).__renderCommandInputs(p),
      { pxW: WIDTH, pxH: 760 },
    );
    // Drive every control that needs a press to reach its phase.
    for (const cell of await page.locator("[data-scenario-cell]").all()) {
      const checkbox = cell.getByRole("checkbox");
      const combo = cell.getByRole("combobox");
      const text = cell.getByRole("textbox");
      const slider = cell.getByRole("slider");
      const spin = cell.getByRole("button", { name: "Increase RPM cap" });
      const button = cell.getByRole("button");
      if (await checkbox.count()) await cell.locator("label").first().click();
      else if (await combo.count()) await combo.selectOption("b");
      else if (await text.count()) {
        await text.fill("Jeb");
        await text.press("Enter");
      } else if (await slider.count()) await slider.press("ArrowRight");
      else if (await spin.count()) await spin.click();
      else if ((await cell.getByRole("menuitem").count()) > 0)
        await cell.getByRole("menuitem").click();
      else if ((await button.count()) > 0) await button.first().click();
    }
    await page.waitForTimeout(700);
    await page.mouse.move(0, 0);
    await page.screenshot({ path: join(OUT_DIR, "command-inputs.png") });
    await page.locator("#real").screenshot({
      path: join(OUT_DIR, "command-inputs-widget.png"),
    });
    console.log("  command-inputs.png");
  } finally {
    await browser.close();
  }
}

readFile(THEME_TOKENS_CSS, "utf8")
  .then(main)
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
