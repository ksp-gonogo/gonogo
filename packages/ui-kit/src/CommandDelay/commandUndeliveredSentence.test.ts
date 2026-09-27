import { describe, expect, it } from "vitest";
import { commandLossSentence } from "./commandLossSentence";
import { commandUndeliveredSentence } from "./commandUndeliveredSentence";

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
