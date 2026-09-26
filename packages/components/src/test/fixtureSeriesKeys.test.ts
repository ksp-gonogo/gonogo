import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { getComponents } from "@ksp-gonogo/core";
import { describe, expect, it } from "vitest";
import "../index";

/**
 * Every `_series` key in a widget fixture is one that widget reads. The block
 * seeds sparklines only in the browser render harness, and a key that matches
 * nothing renders an empty sparkline, indistinguishable from "no history yet".
 * This never renders: an empty sparkline is not a harness error.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const COMPONENTS_SRC = join(HERE, "..");

interface FixtureSeries {
  widgetDir: string;
  fixture: string;
  keys: string[];
}

function readFixtureSeries(): FixtureSeries[] {
  const out: FixtureSeries[] = [];
  for (const widgetDir of readdirSync(COMPONENTS_SRC)) {
    const fixturesDir = join(COMPONENTS_SRC, widgetDir, "__fixtures__");
    let entries: string[];
    try {
      if (!statSync(fixturesDir).isDirectory()) continue;
      entries = readdirSync(fixturesDir);
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.endsWith(".json")) continue;
      let parsed: { _series?: Record<string, unknown> };
      try {
        parsed = JSON.parse(readFileSync(join(fixturesDir, entry), "utf8"));
      } catch {
        continue;
      }
      const series = parsed._series;
      if (series === undefined || series === null) continue;
      out.push({
        widgetDir,
        fixture: entry,
        keys: Object.keys(series),
      });
    }
  }
  return out;
}

const FIXTURE_SERIES = readFixtureSeries();

/** A floor on the enumeration, since a walk that resolved nothing would report no offenders. */
const ENUMERATION_FLOOR = 3;

describe("widget fixture _series keys", () => {
  it("finds fixtures carrying a series block at all", () => {
    expect(FIXTURE_SERIES.length).toBeGreaterThanOrEqual(ENUMERATION_FLOOR);
  });

  it("seeds only keys something actually plots", () => {
    // A fixed series is named in `dataRequirements`; a config-driven one (Graph, the reference overlays, synthetic band edges) in the harness mode config in `scripts/widgets.ts`.
    const plotted = new Set<string>();
    for (const component of getComponents()) {
      for (const key of component.dataRequirements ?? []) plotted.add(key);
      for (const key of (component as { fields?: readonly string[] }).fields ??
        []) {
        plotted.add(key);
      }
    }
    const harness = readFileSync(
      join(HERE, "../../scripts/widgets.ts"),
      "utf8",
    );

    const offenders: string[] = [];
    for (const { widgetDir, fixture, keys } of FIXTURE_SERIES) {
      for (const key of keys) {
        if (plotted.has(key)) continue;
        if (harness.includes(`"${key}"`)) continue;
        offenders.push(`${widgetDir}/__fixtures__/${fixture}: ${key}`);
      }
    }

    expect(
      offenders,
      [
        "A fixture seeds series history under a key no widget declares.",
        "",
        "Nothing consumes it, so the sparkline it was meant to fill renders",
        "empty, which is indistinguishable from 'no history yet'. The render",
        "still looks like a plausible widget, so no harness run can fail on it.",
        "",
        "Rename the key in the fixture to match what the widget reads, or add",
        "it to that widget's dataRequirements if the widget really reads it.",
      ].join("\n"),
    ).toEqual([]);
  });
});
