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
    // "Never sent" alone leaves the operator wondering whether to press again.
    // The command is still in a queue on THIS side, so pressing it again cannot
    // repeat anything, and that is the whole reason the phase exists.
    expect(commandUndeliveredSentence({ command: "a.b" })).toMatch(
      /safe to re-send/i,
    );
  });

  it("says the OPPOSITE of the loss it replaced, in a different shape", () => {
    /*
     * The loss earns its caution from a command that may be waiting on the far
     * side. This one is waiting on ours, where we can see it, so the doubt the
     * loss sentence carries would be a falsehood here.
     *
     * Both were cut to the one fact an operator acts on, which is the risk in
     * pressing again, and cutting is what could blur them: two sentences that
     * differ only by a "may" against a "cannot" read alike at a glance. So this
     * pins the polarity AND the shape, a doubt about the past against a
     * permission for the next press, and neither borrowing the other's words.
     */
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
    // The rail is instrumentation. It says what is true and lets the operator
    // decide; the transport's own reason carries the imperative, and this box
    // is not the transport.
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
    shape: "discrete",
  };

  it("renders nothing for an empty set, like every other member of this family", () => {
    const { container } = render(<CommandUndeliveredList undelivered={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it("announces politely, never assertively", () => {
    // An entry appears here on its own, minutes after the press, when a
    // transport gives up on a link. Assertive is reserved for ABORT.
    render(<CommandUndeliveredList undelivered={[unsent]} />);
    const list = screen.getByRole("status", { name: /never sent/i });
    expect(list.getAttribute("aria-live")).toBeNull();
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
        undelivered={[{ id: "c1", shape: "discrete" }]}
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
