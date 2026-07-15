import { describe, expect, it } from "vitest";
import { describeGamepadInput } from "./gamepadDisplay";

describe("describeGamepadInput", () => {
  it("falls back to the input's own name with no glyph for non-gamepad devices", () => {
    const result = describeGamepadInput(
      { transport: "web-serial" },
      { name: "Stage", role: "face-south" },
    );
    expect(result).toEqual({ name: "Stage" });
  });

  it("falls back to the input's own name with no glyph when there's no role", () => {
    const result = describeGamepadInput(
      { transport: "gamepad", labelPack: "xbox" },
      { name: "Button 17" },
    );
    expect(result).toEqual({ name: "Button 17" });
  });

  it("resolves the pack's name + glyph when a role is present", () => {
    const result = describeGamepadInput(
      { transport: "gamepad", labelPack: "playstation" },
      { name: "Face South", role: "face-south" },
    );
    expect(result.name).toBe("Cross");
    expect(result.glyph).toBeTruthy();
  });

  it("defaults to positional (name only, no glyph) when labelPack is unset", () => {
    const result = describeGamepadInput(
      { transport: "gamepad" },
      { name: "Face South", role: "face-south" },
    );
    expect(result.name).toBe("Face South");
    expect(result.glyph).toBeUndefined();
  });
});
