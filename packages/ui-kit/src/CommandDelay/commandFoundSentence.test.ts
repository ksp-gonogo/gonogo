import { CommandErrorCode, value } from "@ksp-gonogo/sitrep-sdk";
import { describe, expect, it } from "vitest";
import { commandFoundSentence } from "./commandFoundSentence";

describe("commandFoundSentence", () => {
  it("names the subject, the reversal, and that it RAN", () => {
    expect(
      commandFoundSentence({
        outcome: "ran",
        command: "vessel.control.setSas",
        args: undefined,
      }),
    ).toBe("Set Sas: found executed.");
  });

  it("never says confirmed, for any outcome", () => {
    // Not "confirmed": each of these is a command the operator was told to stop waiting for.
    for (const found of [
      { outcome: "ran" as const, command: "a.b" },
      {
        outcome: "refused" as const,
        command: "a.b",
        errorCode: CommandErrorCode.WrongState,
      },
      {
        outcome: "errored" as const,
        command: "a.b",
        error: { code: "E", message: "broke" },
      },
    ]) {
      expect(commandFoundSentence(found)).not.toMatch(/confirmed/i);
    }
  });

  it("quotes the refusal composer rather than keeping a second table of reasons", () => {
    // The refusal's own clause, numbers and all, so the two never disagree.
    expect(
      commandFoundSentence({
        outcome: "refused",
        command: "career.crew.hire",
        label: "Hire Valentina Kerman",
        errorCode: CommandErrorCode.LimitReached,
        breach: {
          facility: "AstronautComplex",
          facilityName: "Astronaut Complex",
          facilityLevel: value("ratio", 1),
          quantity: "activeCrew",
          limit: 16,
          actual: 16,
          unit: "",
        },
      }),
    ).toBe(
      "Hire Valentina Kerman: found refused. the Astronaut Complex holds 16 of 16 active crew.",
    );
  });

  it("names the subject ONCE, never twice", () => {
    const sentence = commandFoundSentence({
      outcome: "refused",
      command: "career.facility.upgrade",
      label: "Upgrade Launch Pad",
      errorCode: CommandErrorCode.AlreadyAtMaximum,
    });
    expect(sentence.match(/Upgrade Launch Pad/g)).toHaveLength(1);
  });

  it("keeps the game's own capitals when it quotes them", () => {
    // Folding case would damage the proper nouns in KSP's own strings.
    expect(
      commandFoundSentence({
        outcome: "refused",
        command: "a.b",
        errorCode: CommandErrorCode.NotClearToProceed,
        detail: "Craft is over the mass limit",
      }),
    ).toMatch(/found refused\. Craft is over the mass limit\./);
  });

  it("says a late error REACHED the game, which is the found half of it", () => {
    expect(
      commandFoundSentence({
        outcome: "errored",
        command: "vessel.stage.next",
        error: { code: "E_HANDLER", message: "the handler threw." },
      }),
    ).toBe("Next: found errored. the handler threw.");
  });

  it("still says something true when a refusal arrives with no reason at all", () => {
    expect(commandFoundSentence({ outcome: "refused", command: "a.b" })).toBe(
      "B: found refused.",
    );
  });
});
