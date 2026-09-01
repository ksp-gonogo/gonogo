import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CHROMIUM_ONLY_SURFACES,
  hasGamepad,
  hasWebSerial,
} from "./capabilities";

describe("capabilities", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("hasWebSerial is true when navigator.serial.requestPort exists", () => {
    vi.stubGlobal("navigator", { serial: { requestPort: () => {} } });
    expect(hasWebSerial()).toBe(true);
  });

  it("hasWebSerial is false when navigator.serial is absent", () => {
    vi.stubGlobal("navigator", {});
    expect(hasWebSerial()).toBe(false);
  });

  it("documents web-serial as a Chromium-only surface", () => {
    expect(CHROMIUM_ONLY_SURFACES.some((s) => s.id === "web-serial")).toBe(
      true,
    );
  });

  it("hasGamepad is true when navigator.getGamepads exists, cross-browser, unlike web-serial", () => {
    vi.stubGlobal("navigator", { getGamepads: () => [] });
    expect(hasGamepad()).toBe(true);
  });

  it("hasGamepad is false when navigator.getGamepads is absent", () => {
    vi.stubGlobal("navigator", {});
    expect(hasGamepad()).toBe(false);
  });

  it("gamepad is deliberately NOT listed as a Chromium-only surface", () => {
    // Widened off the `as const` list, which otherwise narrows the ids to the
    // one entry there is and makes the comparison itself a type error.
    const ids: readonly string[] = CHROMIUM_ONLY_SURFACES.map((s) => s.id);
    expect(ids).not.toContain("gamepad");
  });
});
