#!/usr/bin/env tsx
/**
 * Ext-1 render: the Navball SAS-mode grid as the reference control for the
 * `data-failed` styling convention. Renders the exact primitive Navball emits
 * (ui-kit `ToggleButton`) in three states, so the operator can review the
 * failure tint in context without the full delay pipeline: a normal grid, the
 * same grid with one active mode, and the grid with a FAILED mode (amber
 * `data-failed` tint, its accessible name switched to "activate to dismiss").
 * Same esbuild -> injected HTML -> playwright pipeline as render-delay-rail.ts.
 * Output → local_docs/renders/delay-ux-v3/.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";
import { chromium } from "playwright";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = resolve(HERE, "../../../local_docs/renders/delay-ux-v3");
const THEME_TOKENS_CSS = resolve(HERE, "../../theme/src/tokens.css");

const VIEWPORT_W = 360;
const VIEWPORT_H = 260;

const ENTRY = `
import { createRoot } from "react-dom/client";
import { ToggleButton } from "@ksp-gonogo/ui-kit";

const MODES = ["SAS","PRO","RET","NOR","ANT","RIN","ROU","TGT","ATG","MNV"];

const GRID = {
  display: "grid",
  gridTemplateColumns: "repeat(5, 1fr)",
  gap: "var(--space-4)",
};
const LABEL = {
  fontSize: "var(--font-size-2xs)",
  letterSpacing: "0.12em",
  textTransform: "uppercase",
  color: "var(--color-text-faint)",
  marginBottom: "var(--space-4)",
};

function Grid({ activeIndex, failedIndex }) {
  return (
    <div style={GRID}>
      {MODES.map((m, i) => {
        const isFailed = i === failedIndex;
        return (
          <ToggleButton
            key={m}
            type="button"
            size="sm"
            active={i === activeIndex}
            data-failed={isFailed ? "true" : undefined}
            aria-label={isFailed ? \`SAS \${m} command failed, activate to dismiss\` : undefined}
          >
            {m}
          </ToggleButton>
        );
      })}
    </div>
  );
}

function App() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-12)", padding: "var(--space-12)" }}>
      <div>
        <div style={LABEL}>SAS Mode</div>
        <Grid activeIndex={1} failedIndex={-1} />
      </div>
      <div>
        <div style={LABEL}>SAS Mode · Retrograde command lost</div>
        <Grid activeIndex={1} failedIndex={2} />
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")).render(<App />);
`;

async function main(): Promise<void> {
  await mkdir(OUT_DIR, { recursive: true });

  console.log("Bundling SAS-failed entry with esbuild…");
  const bundleResult = await build({
    stdin: {
      contents: ENTRY,
      resolveDir: resolve(HERE, ".."),
      loader: "tsx",
      sourcefile: "sas-failed-entry.tsx",
    },
    bundle: true,
    format: "esm",
    target: "es2022",
    platform: "browser",
    jsx: "automatic",
    write: false,
    sourcemap: "inline",
    define: { "process.env.NODE_ENV": '"production"' },
  });
  const bundleJs = bundleResult.outputFiles[0].text;
  const themeCss = extractRootBlock(await readFile(THEME_TOKENS_CSS, "utf8"));
  const escapedBundle = bundleJs.replace(/<\/script/gi, "<\\/script");

  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8" />
<style>${themeCss}</style>
<style>
  html,body{margin:0;padding:0;background:var(--color-surface-app);color:var(--color-text-primary);font-family:var(--font-family-mono);}
  #root{box-sizing:border-box;}
</style></head><body><div id="root"></div>
<script type="module">${escapedBundle}</script></body></html>`;

  const htmlOut = join(tmpdir(), `gonogo-sas-failed-${process.pid}.html`);
  await writeFile(htmlOut, html, "utf8");

  console.log("Launching Chromium…");
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({
      viewport: { width: VIEWPORT_W, height: VIEWPORT_H },
      deviceScaleFactor: 2,
      reducedMotion: "reduce",
    });
    const page = await context.newPage();
    page.on("pageerror", (err) => console.error("  [page error]", err.message));
    await page.goto(pathToFileURL(htmlOut).toString(), {
      waitUntil: "domcontentloaded",
    });
    await page.waitForTimeout(200);
    const outName = "07-navball-sas-failed-control.png";
    await page.screenshot({ path: join(OUT_DIR, outName), fullPage: false });
    console.log(`  ${outName}\nRendered SAS-failed control → ${OUT_DIR}`);
  } finally {
    await browser.close();
  }
}

function extractRootBlock(css: string): string {
  const m = css.match(/:root\s*\{[\s\S]*?\}/);
  if (!m) throw new Error("tokens.css: no :root block found");
  return m[0];
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
