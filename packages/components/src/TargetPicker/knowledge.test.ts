import {
  TargetKind,
  TargetKnowledge,
  type TargetListEntry,
  value,
} from "@ksp-gonogo/sitrep-sdk";
import { describe, expect, it } from "vitest";
import { knowledgeCaption, seenAsItIs } from "./knowledge";

function entry(overrides: Partial<TargetListEntry>): TargetListEntry {
  return {
    kind: TargetKind.Vessel,
    name: "Relay",
    vesselId: "relay",
    isCurrent: false,
    ...overrides,
  };
}

describe("what the active craft knows of a target", () => {
  it("sees a craft in range, a part, a body and an entry that says nothing as they are", () => {
    expect(seenAsItIs(entry({ source: TargetKnowledge.InRange }))).toBe(true);
    expect(seenAsItIs(entry({ source: null }))).toBe(true);
    expect(seenAsItIs(entry({}))).toBe(true);
    expect(seenAsItIs(entry({ source: TargetKnowledge.DirectLink }))).toBe(
      false,
    );
    expect(seenAsItIs(entry({ source: TargetKnowledge.CommandCentre }))).toBe(
      false,
    );
  });

  it("says how old the knowledge is and how it came", () => {
    const told = entry({
      source: TargetKnowledge.CommandCentre,
      via: "KSC",
      asOfUt: value("ut", 1000),
    });
    expect(knowledgeCaption(told, value("ut", 1240))).toMatch(
      /^Last heard .+ ago via KSC$/,
    );
    expect(
      knowledgeCaption(
        entry({
          source: TargetKnowledge.DirectLink,
          asOfUt: value("ut", 1000),
        }),
        value("ut", 1050),
      ),
    ).toMatch(/^Last heard .+ ago over a direct radio link$/);
    expect(
      knowledgeCaption(
        entry({ source: TargetKnowledge.InRange }),
        value("ut", 1240),
      ),
    ).toBeNull();
  });

  it("says only that it was heard where the age cannot be worked out", () => {
    const told = entry({ source: TargetKnowledge.CommandCentre, via: "KSC" });
    expect(knowledgeCaption(told, value("ut", 1240))).toBe(
      "Last heard via KSC",
    );
    expect(
      knowledgeCaption({ ...told, asOfUt: value("ut", 1000) }, undefined),
    ).toBe("Last heard via KSC");
    expect(
      knowledgeCaption(
        entry({ source: TargetKnowledge.CommandCentre }),
        value("ut", 5),
      ),
    ).toBe("Last heard from its command centre");
  });
});
