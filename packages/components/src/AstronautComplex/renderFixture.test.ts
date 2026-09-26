import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CrewStanding } from "@ksp-gonogo/sitrep-sdk";
import { describe, expect, it } from "vitest";
import fixture from "./__render__/active-crew-multi-situation.json";

/*
 * The two places a `CrewStanding` can only be written as a NUMBER (a JSON
 * render fixture and a tab's DOM id), checked against the contract, since a
 * wrong ordinal still renders a real tab full of real kerbals.
 */
/** The crew roster this fixture emits; untyped JSON, so the emit list is walked. */
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

// Resolved from the package root: jsdom gives the module no file: URL.
const selectors = readFileSync(
  join(process.cwd(), "scripts", "widgets.ts"),
  "utf8",
);

describe("the astronaut-complex render fixture", () => {
  it("carries a crew roster to check", () => {
    expect(crew?.length ?? 0).toBeGreaterThan(0);
  });

  /** Each row's numeric `standing` means the member its `situation` label names. */
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

  /** Every `standing-N-panel` selector points at a standing the fixture contains; a selector matching nothing still renders a PNG of the default tab. */
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
