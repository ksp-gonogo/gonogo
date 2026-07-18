import { describe, expect, it } from "vitest";
import { LOADER_UPLINK_IDS } from "./flag";

describe("LOADER_UPLINK_IDS", () => {
  it("includes kerbcast alongside the existing scansat/kos entries", () => {
    expect(LOADER_UPLINK_IDS).toContain("kerbcast");
    expect(LOADER_UPLINK_IDS).toContain("scansat");
    expect(LOADER_UPLINK_IDS).toContain("kos");
  });
});
