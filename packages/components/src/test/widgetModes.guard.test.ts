import { describe, expect, it } from "vitest";
import { listWidgets } from "../../scripts/widgets";

/**
 * Every render config's size modes are uniquely named. Snapshot cases are
 * named `${fixture} @ ${mode.name}` and vitest keys its counter on the full
 * name, so a duplicate writes `... 1` and `... 2` for one case and the pair
 * drifts. Auto-appended modes merge by prefix, so a duplicate would slip
 * through silently.
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
        "its snapshot counter on the test name, so they write `... 1` and `... 2`",
        "for what reads as a single case. Rename or remove the duplicate.",
      ].join("\n"),
    ).toEqual([]);
  });
});
