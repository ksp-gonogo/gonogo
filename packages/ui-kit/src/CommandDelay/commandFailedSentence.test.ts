import { describe, expect, it } from "vitest";
import { commandFailedSentence } from "./commandFailedSentence";

describe("commandFailedSentence", () => {
  it("names the subject and says it failed with no verdict", () => {
    expect(
      commandFailedSentence({
        command: "vessel.maneuver.add",
        label: "Add maneuver node",
      }),
    ).toBe("Add maneuver node: failed, with no verdict from the game.");
  });

  it("never calls it refused, sent or lost, which each claim to know more", () => {
    const sentence = commandFailedSentence({ command: "a.b" });
    expect(sentence).not.toMatch(/refused|never sent|may have run|lost/i);
  });

  it("says what the mod said became of it when the fault is one it declares", () => {
    expect(
      commandFailedSentence({
        command: "vessel.control.setActionGroup",
        label: "AG3 on",
        code: "undoneByLoad",
      }),
    ).toBe("AG3 on: failed, a game load undid it before it ran.");
  });

  it("keeps the plain sentence for a code nothing here describes", () => {
    expect(commandFailedSentence({ label: "AG3 on", code: "notACode" })).toBe(
      "AG3 on: failed, with no verdict from the game.",
    );
  });

  it("falls back to the command id when nothing names the dispatch", () => {
    expect(commandFailedSentence({})).toMatch(/^The command:/);
  });
});
