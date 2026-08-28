import { describe, expect, it } from "vitest";
import {
  applyInstallProfile,
  getInstallProfile,
  INSTALL_PROFILES,
  type InstallProfileStreamBlock,
  systemUplinksPayload,
} from "./installProfile";

const SCENE: InstallProfileStreamBlock = {
  carriedChannels: [
    "reliability.summary",
    "reliability.parts",
    "rp1.available",
  ],
  pinnedUt: 1000,
  emits: [
    { channel: "reliability.summary", value: { source: "scene" } },
    { channel: "reliability.parts", value: [{ partId: "p1" }] },
    { channel: "rp1.available", value: {} },
  ],
};

describe("applying an install profile to a scene", () => {
  it("puts the roster on the wire first, so ownership resolves before any read", () => {
    const block = applyInstallProfile(
      getInstallProfile("rp1-testflight"),
      SCENE,
    );
    expect(block.carriedChannels[0]).toBe("system.uplinks");
    expect(block.emits[0]?.channel).toBe("system.uplinks");
    expect(
      block.emits.filter((e) => e.channel === "system.uplinks"),
    ).toHaveLength(1);
  });

  it("replaces a scene's payload rather than racing it", () => {
    const block = applyInstallProfile(
      getInstallProfile("rp1-testflight"),
      SCENE,
    );
    const summaries = block.emits.filter(
      (e) => e.channel === "reliability.summary",
    );
    expect(summaries).toHaveLength(1);
    expect(summaries[0]?.value).toMatchObject({ source: "testflight" });
    // Not named by that profile, so the scene keeps its own part list.
    expect(
      block.emits.find((e) => e.channel === "reliability.parts")?.value,
    ).toEqual([{ partId: "p1" }]);
  });

  it("takes an absent Uplink's channels off the wire entirely", () => {
    const block = applyInstallProfile(getInstallProfile("stock-career"), SCENE);
    expect(block.carriedChannels).not.toContain("rp1.available");
    expect(block.emits.some((e) => e.channel === "rp1.available")).toBe(false);
  });

  it("leaves the scene it was handed untouched", () => {
    applyInstallProfile(getInstallProfile("stock-career"), SCENE);
    expect(SCENE.carriedChannels).toContain("rp1.available");
    expect(SCENE.emits).toHaveLength(3);
    expect(SCENE.pinnedUt).toBe(1000);
  });

  it("carries the view clock through unchanged", () => {
    const block = applyInstallProfile(getInstallProfile("stock-career"), SCENE);
    expect(block.pinnedUt).toBe(1000);
  });
});

describe("the declared profiles", () => {
  it("names an id matching the key it is registered under", () => {
    for (const [id, profile] of Object.entries(INSTALL_PROFILES)) {
      expect(profile.id).toBe(id);
    }
  });

  it("serialises health state as the mod's own integer ordinal", () => {
    const stock = systemUplinksPayload(getInstallProfile("stock-career"));
    const rp1 = stock.uplinks.find((entry) => entry.id === "rp1");
    expect(rp1).toMatchObject({
      available: false,
      health: { state: 2, detail: "RP-1 assembly not loaded" },
    });
    const reliability = stock.uplinks.find(
      (entry) => entry.id === "reliability",
    );
    expect(reliability).toMatchObject({ health: { state: 0 } });
  });

  it("says which provider won each election it speaks about", () => {
    expect(getInstallProfile("rp1-testflight").elections.reliability).toBe(
      "testflight",
    );
    expect(getInstallProfile("rp1-no-testflight").elections.reliability).toBe(
      "kerbalism",
    );
    expect(getInstallProfile("stock-career").elections.reliability).toBe(
      "none",
    );
  });

  it("names the known profiles when asked for one that does not exist", () => {
    expect(() => getInstallProfile("no-such-install")).toThrow(/stock-career/);
  });
});
