import { describe, expect, it } from "vitest";
import { KERNEL_VERSION } from "./index";

describe("sitrep-kernel", () => {
  it("exposes a version marker", () => {
    expect(KERNEL_VERSION).toBe("0.0.0");
  });
});
