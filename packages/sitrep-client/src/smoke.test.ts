import { describe, expect, it } from "vitest";
import { CLIENT_VERSION } from "./index";

describe("sitrep-client", () => {
  it("has a version marker", () => {
    expect(CLIENT_VERSION).toBe("0.0.0");
  });
});
