#!/usr/bin/env tsx
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";
import { chromium, type Locator } from "playwright";
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

const WIDTH = 1800;

/** Presses whichever control a cell holds, once, in the way its kind is operated. */
async function pressCell(cell: Locator): Promise<void> {
  if (await cell.getByRole("checkbox").count()) {
    return cell.locator("label").first().click();
  }
  const combo = cell.getByRole("combobox");
  if (await combo.count()) {
    await combo.selectOption("b");
    return;
  }
  const text = cell.getByRole("textbox");
  if (await text.count()) {
    await text.fill("Jeb");
    return text.press("Enter");
  }
  const slider = cell.getByRole("slider");
  if (await slider.count()) return slider.press("ArrowRight");
  const step = cell.getByRole("button", { name: "Increase RPM cap" });
  if (await step.count()) return step.click();
  const item = cell.getByRole("menuitem", { name: /Cut chute/ });
  if (await item.count()) return item.click();
  const button = cell.getByRole("button");
  if (await button.count()) return button.first().click();
}

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
      await pressCell(cell);
    }
    // The last control pressed keeps keyboard focus and so its focus ring; the faces are drawn without it.
    await page.evaluate(
      "document.activeElement && document.activeElement.blur()",
    );
    await page.waitForTimeout(700);
    await page.mouse.move(0, 0);
    await page.screenshot({ path: join(OUT_DIR, "command-inputs.png") });
    // Boxes must not change size when the word shows: measure the menu, row and field boxes of every column.
    const columnWidths = (await page.evaluate(`(() => {
      const names = ["Switch", "Select", "Text field", "Slider", "Stepper", "Row", "Menu item"];
      const cells = Array.from(document.querySelectorAll("[data-scenario]")).filter(
        (e) => !e.closest("#real"),
      );
      const out = {};
      names.forEach((name, row) => {
        out[name] = cells
          .slice(row * 8, row * 8 + 8)
          .map((c) => Math.round(c.firstElementChild.getBoundingClientRect().width));
      });
      return out;
    })()`)) as Record<string, number[]>;
    for (const [label, widths] of Object.entries(columnWidths)) {
      console.log(`  width of ${label}:`, widths.join(", "));
    }
    // The real menu has a 180 px minimum that would hide any growth, so its natural width is measured with the minimum removed.
    const naturalMenuW = (await page.evaluate(`(() => {
      return Array.from(document.querySelectorAll("[data-real-menu] [role=menu]")).map((m) => {
        const before = m.style.minWidth + "|" + m.style.width;
        m.style.minWidth = "0";
        m.style.width = "max-content";
        const w = Math.round(m.getBoundingClientRect().width);
        m.style.minWidth = before.split("|")[0];
        m.style.width = before.split("|")[1];
        return w;
      });
    })()`)) as number[];
    console.log(
      "  open menu natural width (minimum removed):",
      naturalMenuW.join(", "),
    );
    const menuW = await page
      .locator("[data-real-menu] [role=menu]")
      .evaluateAll((els) =>
        els.map((e) => Math.round(e.getBoundingClientRect().width)),
      );
    console.log("  open menu width at rest, sent, refused:", menuW.join(", "));
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
