import { describe, expect, it } from "vitest";
import { NO_TARGET_SENTINEL, resolveTargetName } from "./telemachus";

describe("resolveTargetName", () => {
  it("treats the Telemachus no-target sentinel as no target", () => {
    // The fork's NavigationHandlers.cs returns this literal string (not "" or
    // null) when nothing is targeted — it must not be rendered as a real name.
    expect(NO_TARGET_SENTINEL).toBe("No Target Selected.");
    expect(resolveTargetName("No Target Selected.")).toBeUndefined();
  });

  it("treats empty / blank / non-string values as no target", () => {
    expect(resolveTargetName("")).toBeUndefined();
    expect(resolveTargetName("   ")).toBeUndefined();
    expect(resolveTargetName(undefined)).toBeUndefined();
    expect(resolveTargetName(null)).toBeUndefined();
    expect(resolveTargetName(42)).toBeUndefined();
  });

  it("passes a real target name through unchanged", () => {
    expect(resolveTargetName("Kerbin Station I")).toBe("Kerbin Station I");
    expect(resolveTargetName("Mun")).toBe("Mun");
  });
});
