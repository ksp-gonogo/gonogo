import { describe, expect, it } from "vitest";
import { SDK_VERSION } from "./index";

describe("telemetry-sdk", () => {
  it("exposes a version marker", () => {
    expect(SDK_VERSION).toBe("0.0.0");
  });
});
