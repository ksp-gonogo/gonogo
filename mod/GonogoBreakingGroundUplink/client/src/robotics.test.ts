import { describe, expect, it } from "vitest";
import { emptyStateText } from "./robotics";

/**
 * The empty-state sentence, against the two cases it exists to tell apart.
 *
 * It was one ternary on `robotics.available`, and it read backwards in BOTH of
 * them: each sentence appeared in exactly the case the other one was written
 * for, which is why nothing caught it. See `robotics.ts` for the full account.
 */
describe("emptyStateText", () => {
  it("names the missing expansion off the DLC fact, with nothing on the craft channel", () => {
    /* Breaking Ground absent: the Uplink goes Unavailable, so
       `robotics.available` never emits and the reading stays pending. This
       said "No rotors on this vessel". */
    expect(emptyStateText(false, undefined, false, "rotors")).toBe(
      "Breaking Ground not installed",
    );
  });

  it("names the craft off robotics.available, with the expansion installed", () => {
    // Breaking Ground present, craft simply carrying none: a definite `false`.
    // This said "Breaking Ground not installed".
    expect(emptyStateText(true, false, false, "robotic parts")).toBe(
      "No robotic parts on this vessel",
    );
  });

  it("says it is waiting while neither fact has landed", () => {
    expect(emptyStateText(undefined, undefined, false, "rotors")).toBe(
      "Waiting for the rotors list",
    );
  });

  it("takes an observed but empty list as the craft answer", () => {
    // `robotics.available` is true for a craft with hinges and no rotor, so
    // the Rotor Tachometer needs the observed list to say there are none.
    expect(emptyStateText(true, true, true, "rotors")).toBe(
      "No rotors on this vessel",
    );
  });

  it("puts the missing expansion ahead of both, since it explains them", () => {
    expect(emptyStateText(false, false, true, "rotors")).toBe(
      "Breaking Ground not installed",
    );
  });
});
