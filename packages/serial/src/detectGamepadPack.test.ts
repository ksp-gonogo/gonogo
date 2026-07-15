import { describe, expect, it } from "vitest";
import { detectGamepadPack } from "./detectGamepadPack";

describe("detectGamepadPack", () => {
  it("detects Sony from a zero-padded vendor id alone (Chrome/macOS/Linux), no name needed", () => {
    expect(detectGamepadPack("054c-0ce6-Wireless Controller")).toBe(
      "playstation",
    );
  });

  it("detects Microsoft from a zero-padded vendor id alone, no name needed", () => {
    expect(detectGamepadPack("045e-02ea-Wireless Controller")).toBe("xbox");
  });

  it("detects Nintendo from a zero-padded vendor id alone, no name needed", () => {
    expect(detectGamepadPack("057e-2009-Wireless Controller")).toBe("nintendo");
  });

  it("does not require zero-padding — Firefox omits it", () => {
    // A real Firefox id shape ("810-3-USB Gamepad") — unrelated vendor,
    // should resolve to positional, not crash or mis-parse a short hex run.
    expect(detectGamepadPack("810-3-USB Gamepad")).toBe("positional");
  });

  it("falls back to a product-name substring match with no vendor id (Safari)", () => {
    expect(
      detectGamepadPack("DUALSHOCK 4 Wireless Controller Extended Gamepad"),
    ).toBe("playstation");
    expect(detectGamepadPack("Xbox Wireless Controller Extended Gamepad")).toBe(
      "xbox",
    );
  });

  it("infers xbox from the constant XInput id string, with or without a name", () => {
    expect(
      detectGamepadPack("Xbox 360 Controller (XInput STANDARD GAMEPAD)"),
    ).toBe("xbox");
    expect(detectGamepadPack("xinput")).toBe("xbox");
  });

  it("falls back to positional for anything unrecognised", () => {
    expect(detectGamepadPack("Some Unknown Pad")).toBe("positional");
  });
});
