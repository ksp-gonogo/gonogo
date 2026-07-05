#!/usr/bin/env tsx
/**
 * Cross-browser bootstrap: render every widget in chromium/firefox/webkit,
 * stitch a 3-up composite per fixture/mode, and print each composite path
 * plus its cross-engine diff ratios. This is the artifact a human reviews
 * before per-engine baselines are committed. It does NOT write baselines,
 * and it does NOT gate on diff ratio — a large ratio is expected for some
 * widgets and is reported, not treated as failure.
 *
 * Robustness: rendering every widget across three engines is the real
 * cross-engine audit, so a single widget throwing a page error in one
 * engine must not abort the whole run. Each engine's batch is wrapped so a
 * mid-batch failure still leaves earlier widgets' PNGs on disk and lets the
 * remaining engines run; the composite pass then skips (and reports) any
 * fixture/mode stem that's missing a per-engine PNG instead of crashing.
 */
import { access, mkdir, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { diffRatio, stitch3up } from "./crossBrowserComposite";
import { renderWidgets } from "./widgetRenderHarness";
import { listWidgets } from "./widgets";

const HERE = resolve(fileURLToPath(import.meta.url), "..");
const LOCAL_DOCS = resolve(HERE, "../../../local_docs");
const ENGINES = ["chromium", "firefox", "webkit"] as const;
type Engine = (typeof ENGINES)[number];

interface EngineFailure {
  engine: Engine;
  error: string;
}

interface MissingStem {
  widgetId: string;
  stem: string;
  missingEngines: Engine[];
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function main(): Promise<void> {
  const widgets = [...listWidgets()];
  const engineFailures: EngineFailure[] = [];

  // Render each engine into its normal outPath with a uniform engine
  // suffix (including chromium) so the three engines' PNGs coexist in one
  // dir and share a `<fixture>--<mode>` grouping stem. A thrown error from
  // one widget aborts only THIS engine's remaining batch — PNGs already
  // written for earlier widgets are untouched, and the other two engines
  // still run in full.
  for (const engine of ENGINES) {
    try {
      await renderWidgets(widgets, { engine, outSuffix: `--${engine}` });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`\n[cross-browser] ${engine} batch aborted: ${message}`);
      console.error(
        `[cross-browser] widgets already rendered keep their ${engine} PNGs; ` +
          "any widget after the failure point is reported as missing below.",
      );
      engineFailures.push({ engine, error: message });
    }
  }

  const summary: { composite: string; ff: number; wk: number }[] = [];
  const missing: MissingStem[] = [];

  for (const w of widgets) {
    const dir = resolve(LOCAL_DOCS, w.outPath);
    const outDir = join(LOCAL_DOCS, "renders/cross-browser", w.widgetId);
    await mkdir(outDir, { recursive: true });
    const files = await readdir(dir);
    // Group by the `<fixture>--<mode>` stem shared across the 3 engine suffixes.
    const stems = new Set(
      files
        .filter((f) => f.endsWith("--chromium.png"))
        .map((f) => f.replace("--chromium.png", "")),
    );
    for (const stem of stems) {
      const cx = join(dir, `${stem}--chromium.png`);
      const ff = join(dir, `${stem}--firefox.png`);
      const wk = join(dir, `${stem}--webkit.png`);
      const [hasFf, hasWk] = await Promise.all([
        fileExists(ff),
        fileExists(wk),
      ]);
      if (!hasFf || !hasWk) {
        const missingEngines: Engine[] = [];
        if (!hasFf) missingEngines.push("firefox");
        if (!hasWk) missingEngines.push("webkit");
        missing.push({ widgetId: w.widgetId, stem, missingEngines });
        continue;
      }
      const composite = join(outDir, `${stem}.3up.png`);
      try {
        await stitch3up([cx, ff, wk], composite);
        summary.push({
          composite,
          ff: await diffRatio(cx, ff),
          wk: await diffRatio(cx, wk),
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(
          `[cross-browser] composite failed for ${w.widgetId}/${stem}: ${message}`,
        );
        missing.push({ widgetId: w.widgetId, stem, missingEngines: [] });
      }
    }
  }

  summary.sort((a, b) => Math.max(b.ff, b.wk) - Math.max(a.ff, a.wk));
  console.log("\n=== Cross-browser composites (largest divergence first) ===");
  for (const s of summary) {
    console.log(
      `${(Math.max(s.ff, s.wk) * 100).toFixed(2).padStart(6)}%  ` +
        `ff=${(s.ff * 100).toFixed(2)}% wk=${(s.wk * 100).toFixed(2)}%  ${s.composite}`,
    );
  }
  console.log(
    `\n${summary.length} composites written. Order is chromium | firefox | webkit.`,
  );

  if (missing.length > 0) {
    console.log(
      `\n=== Skipped (${missing.length} fixture/mode stems missing a per-engine render or composite) ===`,
    );
    for (const m of missing) {
      const reason =
        m.missingEngines.length > 0
          ? `missing ${m.missingEngines.join(", ")}`
          : "stitch/diff error (see log above)";
      console.log(`${m.widgetId} / ${m.stem}: ${reason}`);
    }
  }

  if (engineFailures.length > 0) {
    console.log("\n=== Engine batch failures ===");
    for (const f of engineFailures) {
      console.log(`${f.engine}: ${f.error}`);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
