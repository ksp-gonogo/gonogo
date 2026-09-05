import { CommandErrorCode, value } from "@ksp-gonogo/sitrep-sdk";
import { render, screen } from "@ksp-gonogo/sitrep-sdk/testing";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { expectNoA11yViolations } from "../expectNoA11yViolations";
import {
  CommandFoundList,
  commandFoundSentence,
  type RailFound,
} from "./CommandFoundList";

describe("commandFoundSentence", () => {
  it("names the subject, the reversal, and that it RAN", () => {
    expect(
      commandFoundSentence({
        outcome: "ran",
        command: "vessel.control.setSas",
        args: undefined,
      }),
    ).toBe("Set Sas: found executed after being lost.");
  });

  it("never says confirmed, for any outcome", () => {
    // Confirmed means it worked as expected, and every one of these is a
    // command the operator was told to stop waiting for.
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
    // The clause is the refusal's own, numbers and all. Writing it out again
    // here is how the two would end up disagreeing about what LimitReached says.
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
      "Hire Valentina Kerman: found refused after being lost. The game gave its reason: the Astronaut Complex holds 16 of 16 active crew.",
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
    // KSP's strings are titles and sentences of its own, and folding case would
    // damage the proper nouns in them.
    expect(
      commandFoundSentence({
        outcome: "refused",
        command: "a.b",
        errorCode: CommandErrorCode.NotClearToProceed,
        detail: "Craft is over the mass limit",
      }),
    ).toMatch(/gave its reason: Craft is over the mass limit\./);
  });

  it("says a late error REACHED the game, which is the found half of it", () => {
    expect(
      commandFoundSentence({
        outcome: "errored",
        command: "vessel.stage.next",
        error: { code: "E_HANDLER", message: "the handler threw." },
      }),
    ).toBe(
      "Next: found errored after being lost. It reached the game: the handler threw.",
    );
  });

  it("still says something true when a refusal arrives with no reason at all", () => {
    expect(commandFoundSentence({ outcome: "refused", command: "a.b" })).toBe(
      "B: found refused after being lost.",
    );
  });
});

describe("CommandFoundList", () => {
  const found: RailFound = {
    id: "c0",
    command: "vessel.control.setSas",
    args: { enabled: true },
    label: "",
    outcome: "ran",
    shape: "discrete",
  };

  it("renders nothing for an empty set, like every other member of this family", () => {
    const { container } = render(<CommandFoundList founds={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it("announces politely, never assertively", () => {
    // A command turning up executed is a mission-state change and must reach an
    // operator looking elsewhere. Assertive is reserved for ABORT.
    render(<CommandFoundList founds={[found]} />);
    const list = screen.getByRole("status", { name: /answered/i });
    expect(list.getAttribute("aria-live")).toBeNull();
  });

  it("carries no clear control when no handle can dismiss", () => {
    render(<CommandFoundList founds={[found]} />);
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("dismisses by the dispatch's own requestId", async () => {
    const user = userEvent.setup();
    const cleared: string[] = [];
    render(
      <CommandFoundList
        founds={[found]}
        onDismiss={(id) => cleared.push(id)}
      />,
    );
    await user.click(screen.getByRole("button", { name: /Dismiss Set Sas/i }));
    expect(cleared).toEqual(["c0"]);
  });

  it("has no axe violations", async () => {
    const { container } = render(
      <CommandFoundList founds={[found]} onDismiss={() => {}} />,
    );
    await expectNoA11yViolations(container);
  });
});
