import { getComponent } from "@ksp-gonogo/core";
import { act } from "@ksp-gonogo/test-utils";
import { describe, expect, it } from "vitest";
import { listWidgets } from "../../scripts/widgets";
// Importing the package index self-registers every built-in component.
import "../index";
import { axe } from "./axe";
import { renderedTopicIds } from "./renderedTopicIds";
import { renderWidgetMode } from "./widgetDomSnapshot";

/**
 * Data-driven a11y smoke across every fixture-backed widget, on the same
 * widget list, fixtures and mount path as the PNG and DOM-snapshot harnesses.
 * Every grid mode times every applicable fixture, since widgets size-gate
 * which elements render.
 */

// Eagerly loaded so a widget's fixtures resolve by its `fixturesPath`.
const FIXTURE_MODULES = import.meta.glob<{ default: Record<string, unknown> }>(
  "../*/__fixtures__/*.json",
  { eager: true },
);

function fixturesFor(
  fixturesPath: string,
): Array<[string, Record<string, unknown>]> {
  // fixturesPath is repo-relative ("FuelStatus/__fixtures__"); glob keys are test-file-relative ("../FuelStatus/__fixtures__/foo.json").
  const needle = `../${fixturesPath}/`;
  return Object.entries(FIXTURE_MODULES)
    .filter(([path]) => path.startsWith(needle))
    .map(([path, mod]) => [path.slice(needle.length), mod.default] as const)
    .map(([name, data]) => [name, data] as [string, Record<string, unknown>]);
}

describe("widget a11y smoke", () => {
  for (const widget of listWidgets()) {
    const def = getComponent(widget.widgetId);
    const fixtures = fixturesFor(widget.fixturesPath);
    // A widget with no fixtures gets no coverage here and needs its own axe smoke.
    if (!def || fixtures.length === 0) continue;
    const Widget = def.component as Parameters<
      typeof renderWidgetMode
    >[0]["Widget"];
    const modes = widget.modes.length
      ? widget.modes
      : [{ name: "default", w: 6, h: 6 }];

    describe(widget.widgetId, () => {
      for (const [fixtureName, fixture] of fixtures) {
        const slug = fixtureName.replace(/\.json$/, "");
        for (const mode of modes) {
          // `forFixtures` scopes a mode to specific fixture slugs.
          if (mode.forFixtures && !mode.forFixtures.includes(slug)) continue;
          it(`${slug} @ ${mode.name} has no axe violations and shows no Topic id`, async () => {
            const { container, teardown } = await renderWidgetMode({
              Widget,
              fixture,
              mode,
            });
            try {
              // A pinned TelemetryProvider's clock keeps ticking, and axe() is slow enough for a tick to land mid-call.
              let results: Awaited<ReturnType<typeof axe>> | undefined;
              await act(async () => {
                results = await axe(container);
              });
              expect(results).toHaveNoViolations();
              expect(renderedTopicIds(container)).toEqual([]);
            } finally {
              teardown();
            }
          });
        }
      }
    });
  }
});
