import { railTagsForCommand } from "@ksp-gonogo/sitrep-sdk";
import { render, screen } from "@ksp-gonogo/sitrep-sdk/testing";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { expectNoA11yViolations } from "../expectNoA11yViolations";
import { commandLossSentence } from "./CommandLossList";
import {
  CommandUndeliveredList,
  commandUndeliveredSentence,
  type RailUndelivered,
} from "./CommandUndeliveredList";

// The rail axes come from the production derivations, so the fixtures follow them rather than asserting stale literals.
const RAIL_DISCRETE = railTagsForCommand("vessel.control.setSasMode");

describe("commandUndeliveredSentence", () => {
  it("names the subject and says it was never sent", () => {
    expect(
      commandUndeliveredSentence({
        command: "vessel.control.setSas",
        args: undefined,
      }),
    ).toBe("Set Sas: never sent. Safe to re-send.");
  });

  it("says a re-send is safe, which is the half that decides what happens next", () => {
    // The command never left this side, so pressing again cannot repeat anything.
    expect(commandUndeliveredSentence({ command: "a.b" })).toMatch(
      /safe to re-send/i,
    );
  });

  it("says the OPPOSITE of the loss it replaced, in a different shape", () => {
    // Pins the polarity AND the shape: "may" against "cannot" alone would read alike at a glance.
    const dispatch = { command: "vessel.control.setSas", label: "" };
    expect(commandLossSentence(dispatch)).toMatch(/may have run/i);
    expect(commandLossSentence(dispatch)).not.toMatch(/safe/i);
    expect(commandUndeliveredSentence(dispatch)).toMatch(/safe to re-send/i);
    expect(commandUndeliveredSentence(dispatch)).not.toMatch(/may have run/i);
  });

  it("never calls it lost, the state it replaces", () => {
    expect(commandUndeliveredSentence({ command: "a.b" })).not.toMatch(/lost/i);
  });

  it("states the retry as a fact, never as an instruction", () => {
    // The rail says what is true and never quotes the transport's imperative.
    const sentence = commandUndeliveredSentence({ command: "a.b" });
    expect(sentence).not.toMatch(/\b(reconnect|send it again|retry|press)\b/i);
  });

  it("falls back to the command id when nothing names the dispatch", () => {
    expect(commandUndeliveredSentence({})).toMatch(/^The command:/);
  });
});

describe("CommandUndeliveredList", () => {
  const unsent: RailUndelivered = {
    id: "c0",
    command: "vessel.control.setSas",
    args: { enabled: true },
    label: "",
    tags: RAIL_DISCRETE,
  };

  it("draws no box for an empty set, and keeps its live region mounted and empty", () => {
    render(<CommandUndeliveredList undelivered={[]} />);
    expect(
      screen.getByRole("status", { name: /never sent/i }),
    ).toBeEmptyDOMElement();
  });

  it("announces politely, never assertively", () => {
    // Polite: assertive is reserved for ABORT.
    render(<CommandUndeliveredList undelivered={[unsent]} />);
    const list = screen.getByRole("status", { name: /never sent/i });
    expect(list.getAttribute("aria-live")).not.toBe("assertive");
  });

  it("carries no clear control when no handle can dismiss", () => {
    render(<CommandUndeliveredList undelivered={[unsent]} />);
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("dismisses by the dispatch's own requestId", async () => {
    const user = userEvent.setup();
    const cleared: string[] = [];
    render(
      <CommandUndeliveredList
        undelivered={[unsent]}
        onDismiss={(id) => cleared.push(id)}
      />,
    );
    await user.click(screen.getByRole("button", { name: /Dismiss Set Sas/i }));
    expect(cleared).toEqual(["c0"]);
  });

  it("names the gesture for a dispatch with no subject at all", () => {
    render(
      <CommandUndeliveredList
        undelivered={[{ id: "c1", tags: RAIL_DISCRETE }]}
        onDismiss={() => {}}
      />,
    );
    expect(
      screen.getByRole("button", { name: "Dismiss unsent command" }),
    ).toBeTruthy();
  });

  it("has no axe violations", async () => {
    const { container } = render(
      <CommandUndeliveredList undelivered={[unsent]} onDismiss={() => {}} />,
    );
    await expectNoA11yViolations(container);
  });
});
