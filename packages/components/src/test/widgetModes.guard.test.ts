import { describe, expect, it } from "vitest";
import { listWidgets } from "../../scripts/widgets";

/**
 * Every render config's size modes must be uniquely named.
 *
 * <p>A duplicate is invisible until it corrupts a snapshot file. The DOM
 * snapshot suites name each case `${fixture} @ ${mode.name}`, and vitest keys
 * its snapshot counter on the test's full name, so two modes sharing a name
 * produce two tests that share a name and write `… 1` and `… 2` for what the
 * author believes is one case. The pair then drifts: one leg is pruned as
 * obsolete on a run where it did not execute, and the other mismatches.</p>
 *
 * <p>Written while chasing exactly that shape in `LandingStatus`, where CI
 * generated a `pre-burn-cruise @ mobile-9x8 2` key against a committed file
 * that holds twenty-four clean entries and no numbered duplicates. This guard
 * settles whether a duplicate mode is the cause for any widget, and is worth
 * keeping either way: the auto-appended modes are merged in by prefix, so a
 * widget declaring a second mode with an existing prefix would slip through
 * silently.</p>
 */
describe("widget size modes", () => {
  it("names every mode uniquely within a render config", () => {
    const duplicates: string[] = [];
    for (const config of listWidgets()) {
      const seen = new Set<string>();
      for (const mode of config.modes) {
        if (seen.has(mode.name)) {
          duplicates.push(`${config.label}: ${mode.name}`);
        }
        seen.add(mode.name);
      }
    }
    expect(
      duplicates,
      [
        "A render config lists the same size mode twice.",
        "",
        "Two modes with one name make two TESTS with one name, and vitest keys",
        "its snapshot counter on the test name, so they write `… 1` and `… 2`",
        "for what reads as a single case. Rename or remove the duplicate.",
      ].join("\n"),
    ).toEqual([]);
  });
});
