#!/usr/bin/env tsx
/**
 * Render the not-current mark on `<Unit>`, and MEASURE what it costs a table.
 *
 * Run: `pnpm --filter @ksp-gonogo/ui-kit render:unit-currency [--out <dir>] [--tag before|after]`
 * Default output: local_docs/renders/unit-currency
 *
 * The objection this mark had to answer is a layout one: a glyph beside a
 * value was rejected once already because a prefix or a suffix reflows the
 * column under it every time a channel goes quiet. A structural argument that
 * an out-of-flow box cannot do that is not evidence, so this takes the number:
 * the `ruler` sheet lays out the same table three times (nothing marked,
 * marked, and marked beside a deliberate IN-FLOW dot) and measures all three
 * in a real engine.
 *
 * The third is the CONTROL and is why the other two mean anything. A ruler
 * that cannot see a reflow reports none, which reads exactly like a mark that
 * does not cause one, so the sheet plants a reflow and the run FAILS if the
 * measurement cannot see it.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";
import { chromium } from "playwright";

const HERE = dirname(fileURLToPath(import.meta.url));
const ENTRY = join(HERE, "render-unit-currency.entry.tsx");
const THEME_TOKENS_CSS = resolve(HERE, "../../theme/src/tokens.css");

/** Kept in step with `SHEETS` in the entry, and asserted against it per sheet. */
const SHEETS = [
  { id: "table-current", height: 460 },
  { id: "table-some-held", height: 460 },
  { id: "table-most-held", height: 460 },
  { id: "ruler", height: 1400 },
  { id: "sizes", height: 520 },
] as const;

interface TableMeasurement {
  variant: string;
  table: number;
  columns: Record<string, number>;
}

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? fallback : (process.argv[i + 1] ?? fallback);
}

/** The theme sheet whole, checked to be the tokens file. */
function themeCss(css: string): string {
  if (!/:root\s*\{/.test(css)) {
    throw new Error(`${THEME_TOKENS_CSS}: no :root block`);
  }
  return css;
}

/**
 * The measurement, read back as a report and checked for the one thing that
 * would make it worthless.
 *
 * Two claims, and both have to hold. The marked table measures the same as the
 * unmarked one to the hundredth of a pixel, and the control table (the same
 * dot, in the flow) measures WIDER. Without the second, "no change" is equally
 * the reading of a broken ruler.
 */
function report(taken: readonly TableMeasurement[]): string {
  const [none, marked, control] = taken;
  if (!none || !marked || !control) {
    throw new Error(`expected 3 measurements, got ${taken.length}`);
  }
  const lines = taken.map(
    (m) =>
      `  ${m.variant.padEnd(28)} table ${m.table.toFixed(2).padStart(8)}px   ` +
      Object.entries(m.columns)
        .map(([k, w]) => `${k} ${w.toFixed(2)}`)
        .join("   "),
  );
  const drift = Object.keys(none.columns).filter(
    (k) => none.columns[k] !== marked.columns[k],
  );
  const controlMoved =
    control.table > none.table ||
    Object.keys(none.columns).some(
      (k) => (control.columns[k] ?? 0) > (none.columns[k] ?? 0),
    );
  if (!controlMoved) {
    throw new Error(
      "BLIND: the planted in-flow dot moved nothing, so this measurement " +
        "cannot see a reflow and its 'no reflow' reading means nothing",
    );
  }
  const verdict =
    marked.table === none.table && drift.length === 0
      ? "NO REFLOW: every column and the table itself measure identically marked and unmarked"
      : `REFLOW: ${drift.length ? drift.join(", ") : "the table"} moved when values went stale`;
  return [...lines, "", `  ${verdict}`].join("\n");
}

async function main(): Promise<void> {
  const outDir = resolve(
    arg("out", resolve(HERE, "../../../local_docs/renders/unit-currency")),
  );
  const tag = arg("tag", "after");

  const bundle = await build({
    entryPoints: [ENTRY],
    bundle: true,
    format: "esm",
    target: "es2022",
    platform: "browser",
    jsx: "automatic",
    write: false,
    define: { "process.env.NODE_ENV": '"production"' },
  });
  const js = bundle.outputFiles[0].text.replace(/<\/script/gi, "<\\/script");
  const tokens = themeCss(await readFile(THEME_TOKENS_CSS, "utf8"));
  const html = `<!doctype html><html><head><meta charset="utf-8">
<style>${tokens}
html, body { margin: 0; background: #000; font-family: var(--font-family-mono); }
</style></head><body><div id="root"></div>
<script type="module">${js}</script></body></html>`;
  const page = join(tmpdir(), `gonogo-unit-currency-${process.pid}.html`);
  await writeFile(page, html, "utf8");
  await mkdir(outDir, { recursive: true });

  const browser = await chromium.launch();
  let failures = 0;
  let measured = "";
  try {
    const context = await browser.newContext({ deviceScaleFactor: 2 });
    const tab = await context.newPage();
    tab.on("pageerror", (err) => {
      failures++;
      console.error("  [page error]", err.message);
    });
    for (const [i, sheet] of SHEETS.entries()) {
      await tab.setViewportSize({ width: 900, height: sheet.height });
      const url = `${pathToFileURL(page).toString()}?sheet=${sheet.id}`;
      await tab.goto(url, { waitUntil: "domcontentloaded" });
      await tab.waitForSelector("[data-sheet-ready]", { timeout: 10_000 });
      const root = await tab.$(`[data-sheet="${sheet.id}"]`);
      if (!root) throw new Error(`sheet ${sheet.id} missing (id drifted?)`);
      const n = String(i + 1).padStart(2, "0");
      const out = join(outDir, `${n}-${tag}-${sheet.id}.png`);
      await root.screenshot({ path: out });
      console.log(`  ✓ ${sheet.id} → ${out}`);
      if (sheet.id === "ruler") {
        const raw = await tab.getAttribute(
          "[data-measurements]",
          "data-measurements",
        );
        if (!raw) throw new Error("ruler rendered no measurements");
        measured = report(JSON.parse(raw) as TableMeasurement[]);
      }
    }
  } finally {
    await browser.close();
  }
  if (failures > 0) throw new Error(`${failures} page error(s); see above`);

  const text = `chromium, deviceScaleFactor 2, content-sized tables (CSS px)\n\n${measured}\n`;
  const file = join(outDir, `measurements-${tag}.txt`);
  await writeFile(file, text, "utf8");
  console.log(`\n${text}`);
  console.log(`  ✓ measurements → ${file}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
