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

/**
 * The axe sweep is the slowest file in the package by a wide margin, so it is
 * split across `widgets.axe.<n>.test.tsx` files that vitest's own `--shard`
 * can spread over CI legs. Each widget is in exactly one slice.
 */
export const AXE_SLICES = 8;

interface AxeWidget {
  widget: ReturnType<typeof listWidgets>[number];
  fixtures: Array<[string, Record<string, unknown>]>;
  modes: ReturnType<typeof listWidgets>[number]["modes"];
}

function testsOf(w: AxeWidget): number {
  return w.fixtures.reduce(
    (n, [name]) =>
      n +
      w.modes.filter(
        (m) =>
          !m.forFixtures || m.forFixtures.includes(name.replace(/\.json$/, "")),
      ).length,
    0,
  );
}

/**
 * The covered widgets dealt into `AXE_SLICES` bins, heaviest first into the
 * lightest bin, so the slices cost about the same. Deterministic, so every
 * slice file computes the same partition.
 */
export function axeSlices(): AxeWidget[][] {
  const covered: AxeWidget[] = [];
  for (const widget of listWidgets()) {
    const fixtures = fixturesFor(widget.fixturesPath);
    if (!getComponent(widget.widgetId) || fixtures.length === 0) continue;
    const modes = widget.modes.length
      ? widget.modes
      : [{ name: "default", w: 6, h: 6 }];
    covered.push({ widget, fixtures, modes });
  }
  const bins: AxeWidget[][] = Array.from({ length: AXE_SLICES }, () => []);
  const load = bins.map(() => 0);
  for (const w of [...covered].sort(
    (a, b) =>
      testsOf(b) - testsOf(a) ||
      a.widget.widgetId.localeCompare(b.widget.widgetId),
  )) {
    const lightest = load.indexOf(Math.min(...load));
    bins[lightest].push(w);
    load[lightest] += testsOf(w);
  }
  return bins;
}

export function describeAxeSlice(slice: number): void {
  describe(`widget a11y smoke, slice ${slice}/${AXE_SLICES}`, () => {
    for (const { widget, fixtures, modes } of axeSlices()[slice - 1]) {
      const Widget = getComponent(widget.widgetId)?.component as Parameters<
        typeof renderWidgetMode
      >[0]["Widget"];

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
}
