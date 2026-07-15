import { describe, expect, it } from "vitest";
import { buildGamepadInputs, gamepadTypeId } from "./gamepadShape";

describe("gamepadTypeId", () => {
  it("keys on shape, not identity — two standard 17/4 pads share an id", () => {
    expect(gamepadTypeId(17, 4, "standard")).toBe(
      gamepadTypeId(17, 4, "standard"),
    );
  });

  it("gives a different id to a different shape", () => {
    expect(gamepadTypeId(17, 4, "standard")).not.toBe(
      gamepadTypeId(18, 4, "standard"),
    );
  });

  it("distinguishes standard from non-standard at the same shape", () => {
    expect(gamepadTypeId(17, 4, "standard")).not.toBe(gamepadTypeId(17, 4, ""));
  });

  it("treats any non-'standard' mapping string the same way", () => {
    expect(gamepadTypeId(17, 4, "")).toBe(gamepadTypeId(17, 4, "xinput"));
  });
});

describe("buildGamepadInputs", () => {
  describe("standard mapping", () => {
    const inputs = buildGamepadInputs(18, 4, "standard");

    it("assigns roles to buttons 0-16 from the canonical table", () => {
      expect(inputs.find((i) => i.id === "button-0")?.role).toBe("face-south");
      expect(inputs.find((i) => i.id === "button-16")?.role).toBe("home");
    });

    it("gives a button beyond 16 no role, a generic name, and keeps it bindable", () => {
      const touchpad = inputs.find((i) => i.id === "button-17");
      expect(touchpad).toBeDefined();
      expect(touchpad?.role).toBeUndefined();
      expect(touchpad?.name).toBe("Button 17");
      expect(touchpad?.kind).toBe("button");
    });

    it("makes only buttons 6/7 (the triggers) analog + unipolar", () => {
      const left = inputs.find((i) => i.id === "button-6");
      const right = inputs.find((i) => i.id === "button-7");
      expect(left?.kind).toBe("analog");
      expect(left?.polarity).toBe("unipolar");
      expect(right?.kind).toBe("analog");
      expect(right?.polarity).toBe("unipolar");

      const other = inputs.find((i) => i.id === "button-0");
      expect(other?.kind).toBe("button");
      expect(other?.polarity).toBeUndefined();
    });

    it("names buttons with the positional wording", () => {
      expect(inputs.find((i) => i.id === "button-0")?.name).toBe("Face South");
    });

    it("assigns roles + bipolar polarity to all 4 axes", () => {
      const axisRoles = [
        "stick-left-x",
        "stick-left-y",
        "stick-right-x",
        "stick-right-y",
      ];
      axisRoles.forEach((role, idx) => {
        const axis = inputs.find((i) => i.id === `axis-${idx}`);
        expect(axis?.role).toBe(role);
        expect(axis?.kind).toBe("analog");
        expect(axis?.polarity).toBe("bipolar");
      });
    });

    it("uses the button-<n>/axis-<n> id contract", () => {
      const ids = inputs.map((i) => i.id);
      expect(ids.slice(0, 18)).toEqual(
        Array.from({ length: 18 }, (_, i) => `button-${i}`),
      );
      expect(ids.slice(18)).toEqual(
        Array.from({ length: 4 }, (_, i) => `axis-${i}`),
      );
    });
  });

  describe("non-standard mapping (e.g. Android's '')", () => {
    const inputs = buildGamepadInputs(18, 4, "");

    it("assigns no roles at all", () => {
      expect(inputs.every((i) => i.role === undefined)).toBe(true);
    });

    it("gives every button a generic name and plain 'button' kind", () => {
      const b0 = inputs.find((i) => i.id === "button-0");
      expect(b0?.name).toBe("Button 0");
      expect(b0?.kind).toBe("button");
      expect(b0?.polarity).toBeUndefined();
    });

    it("gives every axis a generic name and analog + bipolar kind", () => {
      const a0 = inputs.find((i) => i.id === "axis-0");
      expect(a0?.name).toBe("Axis 0");
      expect(a0?.kind).toBe("analog");
      expect(a0?.polarity).toBe("bipolar");
    });

    it("still produces every input — nothing is dropped", () => {
      expect(inputs).toHaveLength(22);
    });
  });
});
