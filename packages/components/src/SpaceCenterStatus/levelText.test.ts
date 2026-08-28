import { describe, expect, it } from "vitest";
import { parseLevelText } from "./levelText";

describe("parseLevelText", () => {
  it("turns the game's asterisk-bulleted properties into label/value pairs", () => {
    expect(parseLevelText("* Max Size: 140t\n* Max Parts: 255")).toMatchObject([
      { kind: "pair", label: "Max Size", value: "140t" },
      { kind: "pair", label: "Max Parts", value: "255" },
    ]);
  });

  it("keeps a bulleted line that names no property as a note", () => {
    expect(parseLevelText("* Maneuver nodes enabled")).toMatchObject([
      { kind: "note", text: "Maneuver nodes enabled" },
    ]);
  });

  it("keeps a line the game wrote with no bullet at all", () => {
    expect(parseLevelText("Patched conics (full)")).toMatchObject([
      { kind: "note", text: "Patched conics (full)" },
    ]);
  });

  it("splits on the first colon so a value may contain one", () => {
    expect(parseLevelText("* Window: 12:30 to 14:00")).toMatchObject([
      { kind: "pair", label: "Window", value: "12:30 to 14:00" },
    ]);
  });

  it("keeps a label with an empty value as a note rather than dropping it", () => {
    expect(parseLevelText("* Max Size:")).toMatchObject([
      { kind: "note", text: "Max Size:" },
    ]);
  });

  it("keeps a value with no label as a note", () => {
    expect(parseLevelText("* : 140t")).toMatchObject([
      { kind: "note", text: ": 140t" },
    ]);
  });

  it("yields nothing for an empty or whitespace-only description", () => {
    expect(parseLevelText("")).toEqual([]);
    expect(parseLevelText("  \n\n \n")).toEqual([]);
  });

  it("drops blank lines between items rather than emitting empty rows", () => {
    expect(parseLevelText("* Max crew: 1\n\n* Max Parts: 30")).toMatchObject([
      { kind: "pair", label: "Max crew", value: "1" },
      { kind: "pair", label: "Max Parts", value: "30" },
    ]);
  });

  it("leaves a leading minus alone, so a negative value keeps its sign", () => {
    expect(parseLevelText("* Reputation: -12")).toMatchObject([
      { kind: "pair", label: "Reputation", value: "-12" },
    ]);
    expect(parseLevelText("-12% funds")).toMatchObject([
      { kind: "note", text: "-12% funds" },
    ]);
  });

  it("accepts a bullet character in place of the asterisk", () => {
    expect(parseLevelText("• Max crew: 12")).toMatchObject([
      { kind: "pair", label: "Max crew", value: "12" },
    ]);
  });

  it("gives each line an id, suffixing a repeat so two of them stay apart", () => {
    const specs = parseLevelText("* Max crew: 1\n* Max crew: 1\n* Standby");
    expect(specs.map((s) => s.id)).toEqual([
      "Max crew: 1",
      "Max crew: 1#1",
      "Standby",
    ]);
  });
});
