import { describe, expect, it } from "vitest";
import { emptyStateText } from "./robotics";

/** Proves the empty-state sentence tells a missing expansion from a craft carrying no joints, and waits when neither is known. */
describe("emptyStateText", () => {
  it("names the missing expansion off the DLC fact, with nothing on the craft channel", () => {
    // Without Breaking Ground the Uplink is unavailable, so `robotics.available` never emits.
    expect(emptyStateText(false, undefined, false, "rotors")).toBe(
      "Breaking Ground not installed",
    );
  });

  it("names the craft off robotics.available, with the expansion installed", () => {
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
    // `robotics.available` is true for a craft with hinges and no rotor, so the read list says there are none.
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
