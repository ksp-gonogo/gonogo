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

  it("falls back to the command id when nothing names the dispatch", () => {
    expect(commandFailedSentence({})).toMatch(/^The command:/);
  });
});
