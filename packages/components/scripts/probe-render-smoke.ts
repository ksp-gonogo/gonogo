/**
 * Probe-harness smoke check: does the probe bundle still LOAD in a browser?
 *
 * Builds each probe page with the render harness's own esbuild config, opens it
 * in Chromium, and asserts the page installs the `window` global its driver
 * calls. No fixtures, no widgets, no pixels, no baselines: the single question
 * is whether a top-level throw has made the whole harness unable to render
 * anything.
 *
 * It exists because that is exactly what happened. `8bd2b4e8` added a module-
 * scope `process.env.GONOGO_MUTE_FIXTURE_EMITS` read to
 * `src/test/setupStreamFixture.tsx`, which the probe entry imports, so the
 * bundle threw `process is not defined` before `window.__renderProbe` was ever
 * assigned. Every one of the 42 widgets and 1442 committed baselines stopped
 * being compared to anything, and the only job that could see it was `visual`,
 * which is red on purpose and therefore showed the colour it always shows. A
 * gate whose failure mode is indistinguishable from its normal state is not
 * instrumenting anything.
 *
 * So this check is a DIFFERENT KIND, deliberately placed in the `test` job
 * which is expected green: the same reasoning as the un-fed snapshot gate
 * beside it in CI. It answers "can the harness render at all", a question
 * `visual` cannot ask, and it fails on any future module-load error whatever
 * the cause rather than only on this one's shape.
 */

import { pathToFileURL } from "node:url";
import { chromium } from "playwright";
import { PROBE_PAGES, prepareProbePage } from "./widgetRenderHarness";

/** Generous: the assertion is about loading at all, not about speed, and a
 *  cold CI runner evaluating a ~70k-line bundle is not a failure. */
const INSTALL_TIMEOUT_MS = 30_000;

interface PageFailure {
  page: string;
  reason: string;
  pageErrors: string[];
}

async function main(): Promise<void> {
  const failures: PageFailure[] = [];
  const browser = await chromium.launch();
  try {
    for (const [name, page] of Object.entries(PROBE_PAGES)) {
      console.log(`\n── ${name} (${page.installs}) ──`);
      const htmlPath = await prepareProbePage({
        ...page,
        slug: `smoke-${name}`,
      });
      const tab = await browser.newPage();
      const pageErrors: string[] = [];
      tab.on("pageerror", (err) => {
        console.error("  [page error]", err.message);
        pageErrors.push(err.message);
      });
      tab.on("console", (msg) => {
        if (msg.type() === "error")
          console.error("  [console error]", msg.text());
      });
      try {
        await tab.goto(pathToFileURL(htmlPath).toString(), {
          waitUntil: "domcontentloaded",
        });
        await tab.waitForFunction(
          (global) =>
            typeof (window as unknown as Record<string, unknown>)[global] ===
            "function",
          page.installs,
          { timeout: INSTALL_TIMEOUT_MS },
        );
        console.log(`  window.${page.installs} installed`);
      } catch (err) {
        failures.push({
          page: `${name} (${page.entry})`,
          reason: `window.${page.installs} was never installed: ${err instanceof Error ? err.message.split("\n")[0] : String(err)}`,
          pageErrors: [...new Set(pageErrors)],
        });
      } finally {
        await tab.close();
      }
      // A page that installed its global but ALSO threw is still broken: the
      // throw happened in some other top-level module and the next thing to
      // import it renders wrongly or not at all. Report it rather than letting
      // "the global appeared" stand in for "the bundle is healthy".
      if (
        pageErrors.length > 0 &&
        !failures.some((f) => f.page.startsWith(`${name} `))
      ) {
        failures.push({
          page: `${name} (${page.entry})`,
          reason: `window.${page.installs} installed, but the page raised ${pageErrors.length} uncaught error(s) at module load`,
          pageErrors: [...new Set(pageErrors)],
        });
      }
    }
  } finally {
    await browser.close();
  }

  if (failures.length > 0) {
    console.error(
      `\nprobe-render-smoke: ${failures.length} probe page(s) cannot render.\n` +
        "The render harness is DOWN, so the visual gate and every render-* script\n" +
        "produce nothing at all, not a drifted PNG. Fix the module-load error below;\n" +
        "do not paper over it with an esbuild `define` or a `window.process` banner,\n" +
        "which would only hide the next one.\n",
    );
    for (const f of failures) {
      console.error(`  ✗ ${f.page}`);
      console.error(`      ${f.reason}`);
      for (const e of f.pageErrors) console.error(`      page error: ${e}`);
    }
    process.exit(1);
  }

  console.log(
    `\nprobe-render-smoke: ${Object.keys(PROBE_PAGES).length} probe page(s) loaded and armed.`,
  );
}

main().catch((err) => {
  console.error("probe-render-smoke: the check itself failed to run:", err);
  process.exit(1);
});
