import { CommandErrorCode } from "@ksp-gonogo/sitrep-sdk";
import { describe, expect, it } from "vitest";
import { commandRefusalSentence } from "./commandRefusalSentence";

/**
 * The three worked examples from
 * `local_docs/design/2026-08-21-refusal-text-examples.md`, asserted as whole
 * sentences rather than as fragments.
 *
 * Whole sentences on purpose: every part of this text is composed from a
 * different source (the command id and args name the subject, the error code
 * picks the clause, the breach supplies the numbers, `units.ts` writes them),
 * and asserting `toContain("16")` would pass on a sentence with the cap and the
 * count the wrong way round.
 */
describe("what an operator reads when the game says no", () => {
  it("names the applicant and the complex that is full", () => {
    expect(
      commandRefusalSentence({
        errorCode: CommandErrorCode.LimitReached,
        command: "career.crew.hire",
        args: { applicantName: "Valentina Kerman" },
        breach: {
          facility: "AstronautComplex",
          facilityName: "Astronaut Complex",
          facilityLevel: { magnitude: 1, unit: "ratio" },
          quantity: "activeCrew",
          limit: 16,
          actual: 16,
          unit: "count",
        },
      }),
    ).toBe(
      "Hire Valentina Kerman refused: the Astronaut Complex holds 16 of 16 active crew.",
    );
  });

  it("names the facility and both tiers", () => {
    expect(
      commandRefusalSentence({
        errorCode: CommandErrorCode.AlreadyAtMaximum,
        command: "career.facility.upgrade",
        args: { facilityId: "LaunchPad" },
        breach: {
          facility: "LaunchPad",
          facilityName: "Launch Pad",
          facilityLevel: { magnitude: 1, unit: "ratio" },
          quantity: "tier",
          limit: 3,
          actual: 3,
          unit: "count",
        },
      }),
    ).toBe("Upgrade Launch Pad refused: it is already at tier 3 of 3.");
  });

  it("quotes the price against the balance, in the currency the dashboard writes", () => {
    expect(
      commandRefusalSentence({
        errorCode: CommandErrorCode.InsufficientFunds,
        command: "career.facility.upgrade",
        args: { facilityId: "LaunchPad" },
        breach: {
          facility: "LaunchPad",
          facilityName: "Launch Pad",
          facilityLevel: { magnitude: 1, unit: "ratio" },
          quantity: "funds",
          limit: 189412,
          actual: 253000,
          unit: "funds",
        },
      }),
    ).toBe(
      "Upgrade Launch Pad refused: it costs 253,000f and funds are 189,412f.",
    );
  });

  it("uses a dispatch's own label over anything it could derive", () => {
    expect(
      commandRefusalSentence({
        errorCode: CommandErrorCode.AlreadyAtMaximum,
        command: "career.facility.upgrade",
        args: { facilityId: "Runway" },
        label: "Upgrade the strip",
        breach: {
          facility: "Runway",
          facilityName: "Runway",
          facilityLevel: { magnitude: 1, unit: "ratio" },
          quantity: "tier",
          limit: 3,
          actual: 3,
          unit: "count",
        },
      }),
    ).toBe("Upgrade the strip refused: it is already at tier 3 of 3.");
  });

  it("still says what happened when the numbers did not arrive", () => {
    // An older mod, or a refusal with nothing to compare. The arm alone cannot
    // say "16 of 16", so it says the general thing instead of inventing one.
    expect(
      commandRefusalSentence({
        errorCode: CommandErrorCode.LimitReached,
        command: "career.crew.hire",
        args: { applicantName: "Jebediah Kerman" },
      }),
    ).toBe("Hire Jebediah Kerman refused: a limit has been reached.");
  });

  it("never renders a limit of zero out of a breach that carries none", () => {
    // The trap the contract's own doc names: an absent limit written as 0 reads
    // as a real limit of 0, which is a plausible number and so a silent lie.
    const sentence = commandRefusalSentence({
      errorCode: CommandErrorCode.InsufficientFunds,
      command: "career.facility.upgrade",
      args: { facilityId: "LaunchPad" },
      breach: {
        facility: "LaunchPad",
        facilityName: "Launch Pad",
        facilityLevel: { magnitude: 1, unit: "ratio" },
        quantity: "funds",
        unit: "funds",
      },
    });
    expect(sentence).toBe(
      "Upgrade Launch Pad refused: there are not enough funds.",
    );
    expect(sentence).not.toContain("0");
  });

  it("falls back to the reason's own name for an arm it has no sentence for", () => {
    // Only `Unknown` and `None` get here now: every arm the mod actually
    // refuses with has prose. The fallback stays because a NEWER mod can send
    // an arm this client has never heard of, and the enum member is still the
    // mod's own word for what happened.
    expect(
      commandRefusalSentence({
        errorCode: CommandErrorCode.Unknown,
        command: "vessel.control.stage",
      }),
    ).toBe("Stage refused: Unknown.");
  });

  it("quotes the game rather than the sentence written here", () => {
    // ClearToSaveStatus has seven arms and KSP words each of them. Inferring
    // "not clear" from the mechanism throws away which one, and the arm is the
    // whole of what an operator does about it.
    expect(
      commandRefusalSentence({
        errorCode: CommandErrorCode.NotClearToProceed,
        command: "ksp.recover",
        detail: "the vessel is moving over the surface",
      }),
    ).toBe("Recover refused: the vessel is moving over the surface.");
  });

  it("does not double the full stop when the game supplied one", () => {
    expect(
      commandRefusalSentence({
        errorCode: CommandErrorCode.SiteOccupied,
        command: "ksp.launch",
        detail: "Launch Site Occupied.",
      }),
    ).toBe("Launch refused: Launch Site Occupied.");
  });

  it("says the general thing for an arm the game gave no words for", () => {
    expect(
      commandRefusalSentence({
        errorCode: CommandErrorCode.CareerModeRequired,
        command: "career.crew.hire",
        args: { applicantName: "Jebediah Kerman" },
      }),
    ).toBe("Hire Jebediah Kerman refused: this save is not a career game.");
  });

  it("prefers the comparison over the game's words when it has both", () => {
    // The numbers are the actionable half. A breach that also carried prose
    // must not lose the numbers to it.
    expect(
      commandRefusalSentence({
        errorCode: CommandErrorCode.InsufficientScience,
        command: "career.tech.unlock",
        args: { techId: "electrics" },
        detail: "Not enough Science to research this node",
        breach: {
          facility: "ResearchAndDevelopment",
          facilityName: "R&D",
          facilityLevel: { magnitude: 0, unit: "ratio" },
          quantity: "science",
          limit: 45,
          actual: 90,
          unit: "science",
        },
      }),
    ).toBe(
      "Unlock electrics refused: it costs 90.0sci and science is 45.0sci.",
    );
  });
});
