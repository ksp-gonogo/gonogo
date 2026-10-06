import {
  TargetKind,
  TargetKnowledge,
  type TargetListEntry,
  value,
} from "@ksp-gonogo/sitrep-sdk";
import { describe, expect, it } from "vitest";
import { knowledgeCaption, seenAsItIs, unchangedSinceHeard } from "./knowledge";

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

  it("counts the age from the silence of a live link, and says that is what it is", () => {
    const coasting = entry({
      source: TargetKnowledge.DirectLink,
      asOfUt: value("ut", 1000),
      unchangedToUt: value("ut", 1590),
    });
    expect(unchangedSinceHeard(coasting)).toBe(true);
    const caption = knowledgeCaption(coasting, value("ut", 1600));
    expect(caption).toMatch(
      /^No change heard as of .+ ago, over a direct radio link that is up$/,
    );
    expect(caption).toBe(
      knowledgeCaption(
        { ...coasting, asOfUt: value("ut", 400) },
        value("ut", 1600),
      ),
    );
    expect(knowledgeCaption(coasting, undefined)).toBe(
      "No change heard over a direct radio link that is up",
    );
  });

  it("goes by when it was last heard where silence says nothing later", () => {
    const heard = entry({
      source: TargetKnowledge.DirectLink,
      asOfUt: value("ut", 1000),
    });
    expect(unchangedSinceHeard(heard)).toBe(false);
    expect(
      unchangedSinceHeard({ ...heard, unchangedToUt: value("ut", 1000) }),
    ).toBe(false);
    expect(unchangedSinceHeard({ ...heard, unchangedToUt: null })).toBe(false);
    expect(
      knowledgeCaption({ ...heard, unchangedToUt: null }, value("ut", 1050)),
    ).toMatch(/^Last heard .+ ago over a direct radio link$/);
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
