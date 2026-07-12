import { getComponent } from "@ksp-gonogo/core";
import { act } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { listWidgets } from "../../scripts/widgets";
// Importing the package index self-registers every built-in component,
// so `getComponent(widgetId)` below resolves to the real component.
import "../index";
import { axe } from "./axe";
import { renderWidgetMode } from "./widgetDomSnapshot";

/**
 * Data-driven a11y smoke across every fixture-backed widget. Mirrors the
 * Playwright PNG harness and the DOM-snapshot layer: same widget list
 * (`listWidgets()`), same fixtures, same mount path — but asserts
 * `toHaveNoViolations()` instead of capturing pixels/HTML.
 *
 * Each widget is rendered at every declared grid mode × applicable
 * fixture. Both axes matter: a11y varies by data state (signal-loss vs
 * nominal) AND by grid size, because widgets size-gate which elements
 * render (e.g. CommSignal hides its `aria-label`led bars below 4 rows).
 * Sweeping only the first/smallest mode silently skips those elements.
 */

// Eagerly load every fixture JSON so the data-driven loop can resolve a
// widget's fixtures by its `fixturesPath` (e.g. "FuelStatus/__fixtures__").
const FIXTURE_MODULES = import.meta.glob<{ default: Record<string, unknown> }>(
  "../*/__fixtures__/*.json",
  { eager: true },
);

function fixturesFor(
  fixturesPath: string,
): Array<[string, Record<string, unknown>]> {
  // fixturesPath is repo-relative ("FuelStatus/__fixtures__"); glob keys
  // are test-file-relative ("../FuelStatus/__fixtures__/foo.json").
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
    // NOTE: a widget with no fixtures is silently skipped — it gets ZERO
    // a11y coverage here and nothing fails. Fixtureless widgets (e.g. the
    // Kos* widgets) must add a per-file axe smoke instead (see e.g.
    // KosFiles/index.test.tsx). Don't rely on this sweep for them.
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
          it(`${slug} @ ${mode.name} has no axe violations`, async () => {
            const { container, teardown } = await renderWidgetMode({
              Widget,
              fixture,
              mode,
            });
            try {
              // A fixture carrying `t.universalTime` mounts a pinned
              // `TelemetryProvider` (`widgetDomSnapshot.tsx`'s `ViewUtWrap`)
              // whose `ViewClock` keeps ticking every frame for as long as
              // the widget stays mounted — same live behavior a real
              // `TelemetryProvider` has in production. `axe()` is slow enough
              // that a tick can land mid-call; wrapping it in `act()` keeps
              // that (otherwise value-identical, harmless) tick from
              // triggering React's "update not wrapped in act" warning.
              let results: Awaited<ReturnType<typeof axe>> | undefined;
              await act(async () => {
                results = await axe(container);
              });
              expect(results).toHaveNoViolations();
            } finally {
              teardown();
            }
          });
        }
      }
    });
  }
});
