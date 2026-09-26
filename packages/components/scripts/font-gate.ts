#!/usr/bin/env tsx
/**
 * Font-fallback gate: does any widget draw a glyph in something other than
 * JetBrains Mono?
 *
 * The detector itself (`findFontFallbacks`, chromium's DevTools Protocol
 * `CSS.getPlatformFontsForNode` over every text node under `#root`) lives in
 * the render harness, so it already runs on every chromium render. This
 * script exists for WHERE it runs: `render-widget`, which a person invokes by
 * hand, and the `visual` job, which is red on purpose, are both places a
 * finding lands unseen. Same reasoning as `overlap-gate.ts`.
 *
 * Chromium only: `CSS.getPlatformFontsForNode` is a DevTools Protocol call
 * with no firefox/webkit equivalent, so this never passes `--engine` and the
 * harness's `renderWidgets` only wires the CDP session up under chromium.
 *
 * Renders into a temp directory: the PNGs are a by-product here.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { renderWidgets } from "./widgetRenderHarness";
import { listWidgets } from "./widgets";

/**
 * Below this, the gate is not surveying the widget set, it is iterating over
 * whatever survived. See `overlap-gate.ts`'s own `MIN_WIDGETS` for why this
 * refuses to report a clean run over a set this small.
 */
const MIN_WIDGETS = 30;

async function main(): Promise<void> {
  const widgets = listWidgets();
  if (widgets.length < MIN_WIDGETS) {
    console.error(
      `\nfont-gate: only ${widgets.length} widget config(s) found, expected at ` +
        `least ${MIN_WIDGETS}. Refusing to report a clean run over a set this small.`,
    );
    process.exit(1);
  }

  const outBase = await mkdtemp(join(tmpdir(), "gonogo-font-gate-"));
  console.log(
    `font-gate: ${widgets.length} widgets at tile size, renders → ${outBase}`,
  );
  try {
    await renderWidgets([...widgets], { outBase });
    console.log("\nfont-gate: no widget draws a glyph outside JetBrains Mono.");
  } finally {
    await rm(outBase, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
