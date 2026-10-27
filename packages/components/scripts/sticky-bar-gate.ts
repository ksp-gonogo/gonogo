#!/usr/bin/env tsx
/**
 * Sticky bar gate: a scrolled panel must hide the rows under its title and
 * filter bar. Each case scrolls a filtered widget's body in the real engine
 * and compares the pixels of the bar's rectangle with and without the rows
 * beneath it (see `findContentUnderStickyBar`), so a transparent bar fails
 * where a hit test would pass it.
 *
 * Runs in the render-gate job, which has the browser and the built packages;
 * the unit suites have neither. Set STICKY_BAR_OUT (and STICKY_BAR_SUFFIX) to
 * keep the pictures; otherwise nothing is written.
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { renderWidgets, type WidgetRenderConfig } from "./widgetRenderHarness";

const OUT = process.env.STICKY_BAR_OUT;
const SUFFIX = process.env.STICKY_BAR_SUFFIX ?? "";

const CASES: Array<{ config: WidgetRenderConfig; fixture: string }> = [
  {
    fixture: "instruments-holding-data",
    config: {
      widgetId: "experiments",
      fixturesPath: "Experiments/__fixtures__",
      outPath: "experiments",
      stickyBarMustBackRows: true,
      modes: [{ name: "scrolled-6x7", w: 6, h: 7, scroll: 90 }],
    },
  },
  {
    fixture: "early-career-63-nodes",
    config: {
      widgetId: "research-and-development",
      fixturesPath: "ResearchAndDevelopment/__fixtures__",
      outPath: "research-and-development",
      stickyBarMustBackRows: true,
      modes: [{ name: "scrolled-6x9", w: 6, h: 9, scroll: 90 }],
    },
  },
  {
    fixture: "pre-launch-long-craft-list",
    config: {
      widgetId: "launch-director",
      fixturesPath: "LaunchDirector/__fixtures__",
      outPath: "launch-director",
      stickyBarMustBackRows: true,
      modes: [{ name: "scrolled-7x8", w: 7, h: 8, scroll: 120 }],
    },
  },
];

async function main(): Promise<void> {
  const failures: string[] = [];
  for (const { config, fixture } of CASES) {
    try {
      await renderWidgets([config], {
        fixture,
        capture: OUT !== undefined,
        outBase: OUT ?? mkdtempSync(join(tmpdir(), "sticky-bar-")),
        outSuffix: SUFFIX,
      });
    } catch (err) {
      failures.push(err instanceof Error ? err.message : String(err));
    }
  }
  if (failures.length > 0) {
    console.error(`\nsticky-bar-gate:\n${failures.join("\n\n")}`);
    process.exit(1);
  }
  console.log(
    `\nsticky-bar-gate: ${CASES.length} widgets keep scrolled rows hidden behind their sticky bar.`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
