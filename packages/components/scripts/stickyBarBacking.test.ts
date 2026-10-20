// @vitest-environment node
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { renderWidgets, type WidgetRenderConfig } from "./widgetRenderHarness";

/*
 * Rendered in the real engine: jsdom lays nothing out, so it cannot say what
 * is drawn under a sticky bar. Set STICKY_BAR_OUT (and STICKY_BAR_SUFFIX) to
 * keep the pictures; otherwise nothing is written.
 */
const OUT = process.env.STICKY_BAR_OUT;
const SUFFIX = process.env.STICKY_BAR_SUFFIX ?? "";

const FILTERED_WIDGETS: Array<{ config: WidgetRenderConfig; fixture: string }> =
  [
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

describe("a filtered widget's sticky bar", () => {
  for (const { config, fixture } of FILTERED_WIDGETS) {
    it(`hides the rows of ${config.widgetId} scrolled under it`, async () => {
      await expect(
        renderWidgets([config], {
          fixture,
          capture: OUT !== undefined,
          outBase: OUT ?? mkdtempSync(join(tmpdir(), "sticky-bar-")),
          outSuffix: SUFFIX,
        }),
      ).resolves.toBeUndefined();
    }, 120_000);
  }
});
