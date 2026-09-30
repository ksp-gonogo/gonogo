#!/usr/bin/env tsx
/**
 * Review renders for a `strategies.screens` contribution that draws its own
 * actions: the host draws that screen's cards with neither an Activate button
 * nor a price, because the price it would show is stock's activation cost and
 * the spend belongs to the Uplink's own body. The stock scene is the same
 * roster with no Uplink contributing, where the host's price must still show.
 *
 * Deliberately NOT registered in `widgets.ts`, for the reason
 * `render-eligibility-unknown.ts` gives: that file is the visual gate's
 * input, and a scene added to it with no committed baseline fails the gate
 * as MISSING. This exists to be looked at by a person.
 *
 * Run via `pnpm --filter @ksp-gonogo/components render-admin-building-own-actions`.
 * Pass `--out <dir>` to write somewhere other than this checkout's
 * `local_docs`.
 */
import { renderWidgets, type WidgetRenderConfig } from "./widgetRenderHarness";

const CONFIGS: WidgetRenderConfig[] = [
  {
    widgetId: "strategies",
    label: "strategies/admin-building-own-actions",
    slug: "strategies-own-actions",
    fixturesPath: "Strategies/__fixtures__/probe",
    outPath: "renders/admin-building-own-actions",
    fullContent: true,
    modes: [
      { name: "wide-9x12", w: 9, h: 12, forFixtures: ["own-actions-screen"] },
    ],
  },
  {
    widgetId: "strategies",
    label: "strategies/stock",
    slug: "strategies-stock",
    fixturesPath: "Strategies/__fixtures__",
    outPath: "renders/admin-building-stock",
    fullContent: true,
    modes: [
      { name: "wide-9x12", w: 9, h: 12, forFixtures: ["small-career-detail"] },
    ],
  },
];

const outFlag = process.argv.indexOf("--out");
const outBase = outFlag !== -1 ? process.argv[outFlag + 1] : undefined;

renderWidgets(CONFIGS, { outBase }).catch((err) => {
  console.error(err);
  process.exit(1);
});
