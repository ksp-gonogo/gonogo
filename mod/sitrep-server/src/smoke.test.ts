import { describe, expect, it } from "vitest";
import { SERVER_VERSION } from "./index";

describe("sitrep-server", () => {
  it("exposes a version marker", () => {
    expect(SERVER_VERSION).toBe("0.0.0");
  });
});
