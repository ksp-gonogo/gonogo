import { afterEach, describe, expect, it, vi } from "vitest";
import { CHROMIUM_ONLY_SURFACES, hasWebSerial } from "./capabilities";

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
});
