import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readWireSurface, wireSection } from "./wire";

const scratch: string[] = [];
afterEach(() => {
  for (const dir of scratch.splice(0))
    rmSync(dir, { recursive: true, force: true });
});

/** A client package with a generated contract slice in it, or without one. */
function slice(files: Record<string, string> | undefined) {
  const dir = mkdtempSync(join(tmpdir(), "gonogo-wire-"));
  scratch.push(dir);
  if (files) {
    const gen = join(dir, "src", "__generated__");
    mkdirSync(gen, { recursive: true });
    for (const [name, body] of Object.entries(files)) {
      writeFileSync(join(gen, name), body);
    }
  }
  return dir;
}

const UNITS = JSON.stringify({
  version: 1,
  types: {
    ScanCoverage: { body: "id", covered: "%" },
    ScanArgs: { body: "id" },
    ScanVessel: { altitude: "m" },
  },
  topics: { "scan.coverage": { body: "id", covered: "%" } },
  typeShapes: { ScanCoverage: { vessels: "ScanVessel[]" } },
  topicShapes: { "scan.coverage": { vessels: "ScanVessel[]" } },
});

const TOPIC_MAP = `// generated header naming "scan.coverage" in prose
export interface GeneratedTopicPayloadMap {
  "scan.coverage": ScanCoverage;
}
`;

describe("readWireSurface", () => {
  it("reads a channel's payload, its array-ness and every field's declared unit", () => {
    const surface = readWireSurface(
      slice({ "units.json": UNITS, "topic-map.ts": TOPIC_MAP }),
    );

    expect(surface.present).toBe(true);
    expect(surface.channels).toEqual([
      {
        id: "scan.coverage",
        payload: "ScanCoverage",
        array: false,
        fields: [
          { name: "body", unit: "id", shape: undefined },
          { name: "covered", unit: "%", shape: undefined },
          { name: "vessels", unit: undefined, shape: "ScanVessel[]" },
        ],
        // No C# beside a temp directory, so nothing to scan and nothing claimed.
        disposition: {},
      },
    ]);
  });

  it("carries the array flag, which is the difference between one and many on the wire", () => {
    const surface = readWireSurface(
      slice({
        "units.json": JSON.stringify({ topics: { "a.b": { x: "m" } } }),
        "topic-map.ts": '\nexport interface M {\n  "a.b": Thing[];\n}\n',
      }),
    );
    expect(surface.channels[0]).toMatchObject({
      payload: "Thing",
      array: true,
    });
  });

  /**
   * The split is the accuracy fix that made this worth separating: with one
   * bucket the page told a reader that a provider-extension shape was a
   * command's arguments, which is a specific claim and was wrong.
   */
  it("separates a shape another payload HOLDS from one with no route it can name", () => {
    const surface = readWireSurface(
      slice({ "units.json": UNITS, "topic-map.ts": TOPIC_MAP }),
    );
    // ScanCoverage rides scan.coverage, so the channel row describes it and it
    // is in neither bucket.
    expect(surface.nested.map((p) => p.name)).toEqual(["ScanVessel"]);
    expect(surface.payloads.map((p) => p.name)).toEqual(["ScanArgs"]);
  });

  it("strips the plural markers, so a list or dictionary of a shape still counts as held", () => {
    const surface = readWireSurface(
      slice({
        "units.json": JSON.stringify({
          types: { Held: { x: "m" }, Dict: { y: "m" }, Loose: { z: "m" } },
          topics: {},
          typeShapes: { Held: { many: "Dict" } },
          topicShapes: { "a.b": { some: "Held[]" } },
        }),
        "topic-map.ts": "export interface M {}\n",
      }),
    );
    expect(surface.nested.map((p) => p.name)).toEqual(["Dict", "Held"]);
    expect(surface.payloads.map((p) => p.name)).toEqual(["Loose"]);
  });

  it("reports absent, not empty, for an Uplink with no contract slice", () => {
    const surface = readWireSurface(slice(undefined));
    expect(surface.present).toBe(false);
    expect(wireSection(surface)).toEqual([]);
  });

  /**
   * The parse of `topic-map.ts` is the one fragile instrument in this module, so
   * it has to be able to fail. A channel whose payload the parse did not find
   * would otherwise render a row with a blank type, which reads as "this channel
   * carries nothing" and is indistinguishable from a real declaration.
   */
  it("refuses a channel whose payload the topic-map parse did not find", () => {
    expect(() =>
      readWireSurface(
        slice({
          "units.json": UNITS,
          "topic-map.ts": "export interface M {}\n",
        }),
      ),
    ).toThrow(/does not say what payload it carries/);
  });

  it("does not match a topic id that only appears in the generated file's prose", () => {
    // The real emitted header quotes topic ids while explaining what the map
    // excludes. Matching one of those would invent a channel out of a comment.
    const surface = readWireSurface(
      slice({
        "units.json": JSON.stringify({ topics: {} }),
        "topic-map.ts":
          '// asking this file about "fleet.<guid>.orbit" gets a no\n',
      }),
    );
    expect(surface.channels).toEqual([]);
  });
});

describe("wireSection", () => {
  it("renders two tables and no sentences", () => {
    const md = wireSection(
      readWireSurface(
        slice({ "units.json": UNITS, "topic-map.ts": TOPIC_MAP }),
      ),
    ).join("\n");

    expect(md).toContain("## Wire");
    // Delivery and delay come from the C# declaration site, and there is no C#
    // beside a temp directory, so both read as an en dash rather than as a guess.
    expect(md).toContain("| `scan.coverage` | `ScanCoverage` | – | – |");
    // ONE payload table, holding the nested shape and the command args alike:
    // three routes onto the wire, and the generated slice does not say which.
    expect(md).toContain("| `ScanArgs` | `body` id |");
    expect(md).toContain("| `ScanVessel` | `altitude` m |");
    // No prose between the tables, and no headings under `## Wire`.
    expect(md).not.toContain("###");
  });

  it("prints no channel table at all when there is no statically-named channel", () => {
    const md = wireSection(
      readWireSurface(
        slice({
          "units.json": JSON.stringify({
            topics: {},
            types: { OnlyArgs: { x: "id" } },
          }),
          "topic-map.ts": "export interface M {}\n",
        }),
      ),
    ).join("\n");

    // A sentence saying the table is empty is the kind of line this page does
    // not carry: the payload table below is the whole statement.
    expect(md).toContain("| `OnlyArgs` | `x` id |");
    expect(md).not.toContain("| Topic |");
  });
});
