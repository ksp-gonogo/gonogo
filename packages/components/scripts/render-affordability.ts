#!/usr/bin/env tsx
/**
 * Review renders for the standing-drain readout every funds-spending widget
 * carries beside its balance.
 *
 * Each widget is rendered against the same career three ways: an economy model
 * that reports no standing cost (stock), one that reports a cost the subsidy
 * does not cover, and one where the subsidy wins. The stock render must look
 * exactly as the widget did before the readout existed, which is the property
 * a side-by-side is the only honest way to check.
 *
 * Deliberately NOT registered in `widgets.ts`: that file is the visual gate's
 * input, and these fixtures exist to be looked at by a person rather than
 * diffed against a committed baseline.
 *
 * Run via `pnpm --filter @ksp-gonogo/components render-affordability`. Pass
 * `--out <dir>` to write somewhere other than this checkout's `local_docs`.
 */
import { renderWidgets, type WidgetRenderConfig } from "./widgetRenderHarness";

const CONFIGS: WidgetRenderConfig[] = [
  {
    widgetId: "space-center-status",
    label: "space-center-status-affordability",
    slug: "space-center-status-affordability",
    fixturesPath: "SpaceCenterStatus/__affordability__",
    outPath: "renders/affordability/space-center-status",
    fullContent: true,
    modes: [
      { name: "default-6x7", w: 6, h: 7 },
      { name: "tiny-2x3", w: 2, h: 3 },
    ],
  },
  {
    widgetId: "launch-director",
    label: "launch-director-affordability",
    slug: "launch-director-affordability",
    fixturesPath: "LaunchDirector/__affordability__",
    outPath: "renders/affordability/launch-director",
    fullContent: true,
    modes: [{ name: "default-7x10", w: 7, h: 10 }],
  },
  {
    widgetId: "astronaut-complex",
    label: "astronaut-complex-affordability",
    slug: "astronaut-complex-affordability",
    fixturesPath: "AstronautComplex/__affordability__",
    outPath: "renders/affordability/astronaut-complex",
    fullContent: true,
    modes: [{ name: "default-6x9", w: 6, h: 9 }],
  },
  {
    widgetId: "strategies",
    label: "strategies-affordability",
    slug: "strategies-affordability",
    fixturesPath: "Strategies/__affordability__",
    outPath: "renders/affordability/strategies",
    fullContent: true,
    modes: [
      // The balance rail this widget carries lives in the panel aside, which
      // only has room to render at the wide bucket.
      { name: "wide-9x12", w: 9, h: 12 },
      { name: "tiny-3x3", w: 3, h: 3 },
    ],
  },
];

const outFlag = process.argv.indexOf("--out");
const outBase = outFlag !== -1 ? process.argv[outFlag + 1] : undefined;

renderWidgets(CONFIGS, { fullContent: true, outBase }).catch((err) => {
  console.error(err);
  process.exit(1);
});
