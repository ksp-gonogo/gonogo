import { describe, expect, it } from "vitest";
import { lockSentence } from "./capability-lock";

const facility = (name: string, tier?: number) => ({
  locks: [
    {
      capability: { kind: "command", id: "x" },
      missing: [{ kind: 1, id: name, name, ...(tier == null ? {} : { tier }) }],
    },
  ],
});

const write = (q: { magnitude: number } | number) =>
  String(typeof q === "number" ? q : q.magnitude);

describe("lockSentence for a building", () => {
  it("names the level the game shows, without a placeholder word", () => {
    const { locks } = facility("Tracking Station", 2);
    // biome-ignore lint/suspicious/noExplicitAny: minimal lock fixture
    expect(lockSentence(locks as any, write)).toEqual({
      reason: "Tracking Station",
      hint: "Needs level 2",
    });
  });

  it("says no level when the game cannot name one", () => {
    const { locks } = facility("Tracking Station");
    // biome-ignore lint/suspicious/noExplicitAny: minimal lock fixture
    expect(lockSentence(locks as any, write).hint).toBeUndefined();
  });
});
