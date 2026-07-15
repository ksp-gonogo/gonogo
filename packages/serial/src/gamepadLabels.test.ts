import { describe, expect, it } from "vitest";
import { resolveGamepadLabel } from "./gamepadLabels";

describe("resolveGamepadLabel", () => {
  it("positional uses the same wording as the auto-generated name", () => {
    expect(resolveGamepadLabel("face-south", "positional")).toBe("Face South");
    expect(resolveGamepadLabel("stick-left-x", "positional")).toBe(
      "Stick Left X",
    );
  });

  it("xbox uses letter labels", () => {
    expect(resolveGamepadLabel("face-south", "xbox")).toBe("A");
    expect(resolveGamepadLabel("face-east", "xbox")).toBe("B");
  });

  it("playstation uses shape labels", () => {
    expect(resolveGamepadLabel("face-south", "playstation")).toBe("Cross");
    expect(resolveGamepadLabel("face-east", "playstation")).toBe("Circle");
  });

  it("nintendo swaps the face buttons relative to xbox — not a typo", () => {
    // Same physical position (bottom of the right cluster) is A on Xbox,
    // B on Nintendo.
    expect(resolveGamepadLabel("face-south", "nintendo")).toBe("B");
    expect(resolveGamepadLabel("face-east", "nintendo")).toBe("A");
    expect(resolveGamepadLabel("face-west", "nintendo")).toBe("Y");
    expect(resolveGamepadLabel("face-north", "nintendo")).toBe("X");
  });

  it("every role resolves in every pack — no gaps", () => {
    const packs = ["positional", "xbox", "playstation", "nintendo"] as const;
    const roles = [
      "face-south",
      "face-east",
      "face-west",
      "face-north",
      "bumper-left",
      "bumper-right",
      "trigger-left",
      "trigger-right",
      "select",
      "start",
      "stick-left-press",
      "stick-right-press",
      "dpad-up",
      "dpad-down",
      "dpad-left",
      "dpad-right",
      "home",
      "stick-left-x",
      "stick-left-y",
      "stick-right-x",
      "stick-right-y",
    ] as const;
    for (const pack of packs) {
      for (const role of roles) {
        expect(resolveGamepadLabel(role, pack)).toBeTruthy();
      }
    }
  });
});
