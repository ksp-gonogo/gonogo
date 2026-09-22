import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CrewStanding } from "@ksp-gonogo/sitrep-sdk";
import { describe, expect, it } from "vitest";
import fixture from "./__render__/active-crew-multi-situation.json";

/**
 * The two places a `CrewStanding` can only be written as a NUMBER, guarded
 * against the contract renumbering underneath them.
 *
 * A render fixture is JSON and a tab's DOM id is a string, so neither can name
 * the enum member. That was fine until the contract inserted `Training` and
 * `Resting` in the middle, which moved four members: the fixture then described
 * a roster nobody had, and three render definitions clicked the wrong tab. Both
 * failures are SILENT, because a wrong standing renders a real tab full of real
 * kerbals and a wrong selector opens a real panel. Nothing goes red.
 *
 * <p>The unit tests and the widget itself have no such problem, because they
 * name the member. These two cannot, so they are checked instead.</p>
 */
/**
 * The crew roster this fixture emits, which the two checks below read member
 * by member. A fixture file is untyped JSON, so the emit list is walked rather
 * than indexed.
 */
function crewRosterEmit(): Array<{
  name: string;
  situation: string;
  standing: number;
}> {
  const emits = fixture._stream?.emits;
  if (!Array.isArray(emits)) {
    throw new Error("the render fixture declares no _stream.emits");
  }
  const rows: unknown[] = emits;
  for (const emit of rows) {
    if (typeof emit !== "object" || emit === null) continue;
    if (Reflect.get(emit, "channel") !== "spaceCenter.crewRoster") continue;
    const value: unknown = Reflect.get(emit, "value");
    if (Array.isArray(value)) {
      return value as Array<{
        name: string;
        situation: string;
        standing: number;
      }>;
    }
  }
  throw new Error("the render fixture emits no spaceCenter.crewRoster");
}

const crew = crewRosterEmit();

// Resolved from the package root rather than from `import.meta.url`: the jsdom
// environment these tests run in does not give the module a file: URL.
const selectors = readFileSync(
  join(process.cwd(), "scripts", "widgets.ts"),
  "utf8",
);

describe("the astronaut-complex render fixture", () => {
  it("carries a crew roster to check", () => {
    expect(crew?.length ?? 0).toBeGreaterThan(0);
  });

  /**
   * Each row's numeric `standing` still means the member its own `situation`
   * label names. The label is the human-readable half a reviewer actually reads,
   * so pinning the two together is what makes the number checkable at all.
   */
  it("agrees with itself about which standing each row is in", () => {
    for (const row of crew) {
      expect(
        { name: row.name, standing: row.standing },
        `${row.name} is labelled ${row.situation}`,
      ).toEqual({
        name: row.name,
        standing: CrewStanding[row.situation as keyof typeof CrewStanding],
      });
    }
  });

  /**
   * Every `standing-N-panel` selector in the render definitions points at a
   * standing this fixture actually contains. A selector left on a stale ordinal
   * either opens somebody else's tab or matches nothing, and a render that
   * matched nothing still produces a PNG of the default tab.
   */
  it("is the target of every standing selector the render modes click", () => {
    const present = new Set(crew.map((row) => row.standing));
    const clicked = [...selectors.matchAll(/standing-(\d+)-panel/g)].map((m) =>
      Number(m[1]),
    );

    expect(clicked.length).toBeGreaterThan(0);
    for (const standing of clicked) {
      expect(
        present.has(standing),
        `no row in the fixture has standing ${standing} (${
          CrewStanding[standing] ?? "unnamed"
        })`,
      ).toBe(true);
    }
  });
});
