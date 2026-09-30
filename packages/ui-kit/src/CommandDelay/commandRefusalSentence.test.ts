import {
  CommandErrorCode,
  noteRosterErrorCodes,
  value,
} from "@ksp-gonogo/sitrep-sdk";
import { describe, expect, it } from "vitest";
import { commandRefusalSentence } from "./commandRefusalSentence";

// Asserted as whole sentences: `toContain("16")` would pass with the cap and the count the wrong way round.
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
          facilityLevel: value("ratio", 1),
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
          facilityLevel: value("ratio", 1),
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
          facilityLevel: value("ratio", 1),
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
          facilityLevel: value("ratio", 1),
          quantity: "tier",
          limit: 3,
          actual: 3,
          unit: "count",
        },
      }),
    ).toBe("Upgrade the strip refused: it is already at tier 3 of 3.");
  });

  it("still says what happened when the numbers did not arrive", () => {
    // With nothing to compare, the arm says the general thing rather than inventing numbers.
    expect(
      commandRefusalSentence({
        errorCode: CommandErrorCode.LimitReached,
        command: "career.crew.hire",
        args: { applicantName: "Jebediah Kerman" },
      }),
    ).toBe("Hire Jebediah Kerman refused: a limit has been reached.");
  });

  it("never renders a limit of zero out of a breach that carries none", () => {
    // An absent limit written as 0 would read as a real limit of 0.
    const sentence = commandRefusalSentence({
      errorCode: CommandErrorCode.InsufficientFunds,
      command: "career.facility.upgrade",
      args: { facilityId: "LaunchPad" },
      breach: {
        facility: "LaunchPad",
        facilityName: "Launch Pad",
        facilityLevel: value("ratio", 1),
        quantity: "funds",
        unit: "funds",
      },
    });
    expect(sentence).toBe(
      "Upgrade Launch Pad refused: there are not enough funds.",
    );
    expect(sentence).not.toContain("0");
  });

  it("says nothing about the craft when the mod could not read the answer", () => {
    // `Unreadable` means no answer arrived, so the sentence must not describe the vehicle or imply a withheld reason.
    const sentence = commandRefusalSentence({
      errorCode: CommandErrorCode.Unreadable,
      command: "vessel.control.stage",
    });
    expect(sentence).toBe("Stage refused: the game would not answer.");
    expect(sentence).not.toContain("craft");
    expect(sentence).not.toContain("cannot");
  });

  it("prefers what the mod named over the general unreadable sentence", () => {
    // The general row is the floor; a producer's own clause wins.
    expect(
      commandRefusalSentence({
        errorCode: CommandErrorCode.Unreadable,
        command: "vessel.control.stage",
        detail:
          "The stage count could not be read, so nothing was sent. It may or may not have staged already",
      }),
    ).toBe(
      "Stage refused: The stage count could not be read, so nothing was sent. It may or may not have staged already.",
    );
  });

  it("falls back to the id itself for a code nothing declares", () => {
    // A newer mod can send a root this client has never heard of.
    expect(
      commandRefusalSentence({
        errorCode: "aRootFromALaterMod" as CommandErrorCode,
        command: "vessel.control.stage",
      }),
    ).toBe("Stage refused: aRootFromALaterMod.");
  });

  it("falls back to the root's sentence for a refinement nothing declares", () => {
    // The root always travels, so an unknown refinement still has a category.
    expect(
      commandRefusalSentence({
        errorCode: CommandErrorCode.CareerModeRequired,
        reason: "someUplink.notDeclaredHere",
        command: "career.facility.upgrade",
      }),
    ).toBe("Upgrade refused: this save is not a career game.");
  });

  it("reads a refinement the running mod listed on the roster", () => {
    noteRosterErrorCodes({
      uplinks: [
        {
          errorCodes: [
            {
              id: "rosterProbe.notManaging",
              refines: "careerModeRequired",
              sentence: "the probe is not managing this save",
            },
          ],
        },
      ],
    });
    expect(
      commandRefusalSentence({
        errorCode: CommandErrorCode.CareerModeRequired,
        reason: "rosterProbe.notManaging",
        command: "career.facility.upgrade",
      }),
    ).toBe("Upgrade refused: the probe is not managing this save.");
  });

  it("quotes the game rather than the sentence written here", () => {
    // KSP words each ClearToSaveStatus arm, and which arm it was is what the operator acts on.
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

  it("quotes a contributed requirement's own reason", () => {
    expect(
      commandRefusalSentence({
        errorCode: CommandErrorCode.WrongState,
        command: "ksp.launch",
        args: { shipName: "V-2" },
        detail:
          '"V-2" is in the warehouse at LC-1 and has not been rolled out to a pad',
      }),
    ).toBe(
      'Launch V-2 refused: "V-2" is in the warehouse at LC-1 and has not been rolled out to a pad.',
    );
  });

  it("names the centre and the site when the sender has no authority over the pad", () => {
    expect(
      commandRefusalSentence({
        errorCode: CommandErrorCode.OutOfReach,
        command: "ksp.launch",
        args: { shipName: "Kerbal X" },
        detail:
          "Ike Base is in the Duna system, and a launch from Launch Pad needs a command centre in the Kerbin system",
      }),
    ).toBe(
      "Launch Kerbal X refused: Ike Base is in the Duna system, and a launch from Launch Pad needs a command centre in the Kerbin system.",
    );
  });

  it("says the general thing for an out-of-reach refusal that carried no reason", () => {
    expect(
      commandRefusalSentence({
        errorCode: CommandErrorCode.OutOfReach,
        command: "ksp.launch",
        args: { shipName: "Kerbal X" },
      }),
    ).toBe(
      "Launch Kerbal X refused: this command centre has no authority over that place.",
    );
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
    // A breach that also carries prose keeps its numbers.
    expect(
      commandRefusalSentence({
        errorCode: CommandErrorCode.InsufficientScience,
        command: "career.tech.unlock",
        args: { techId: "electrics" },
        detail: "Not enough Science to research this node",
        breach: {
          facility: "ResearchAndDevelopment",
          facilityName: "R&D",
          facilityLevel: value("ratio", 0),
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
