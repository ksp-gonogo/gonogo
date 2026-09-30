import { describe, expect, it } from "vitest";
import {
  applyInstallProfile,
  getInstallProfile,
  INSTALL_PROFILES,
  type InstallProfileStreamBlock,
  systemUplinksPayload,
} from "./installProfile";

const SCENE: InstallProfileStreamBlock = {
  pinnedUt: 1000,
  emits: [
    { channel: "planted.pads", value: [{ id: "scene-pad" }] },
    { channel: "vessel.identity", value: { vesselId: "v1" } },
    { channel: "planted.available", value: {} },
  ],
};

describe("applying an install profile to a scene", () => {
  it("puts the roster on the wire first, so ownership resolves before any read", () => {
    const block = applyInstallProfile(
      getInstallProfile("planted-space-centre"),
      SCENE,
    );
    expect(block.emits[0]?.channel).toBe("system.uplinks");
    expect(
      block.emits.filter((e) => e.channel === "system.uplinks"),
    ).toHaveLength(1);
  });

  it("replaces a scene's payload rather than racing it", () => {
    const block = applyInstallProfile(
      getInstallProfile("planted-space-centre"),
      SCENE,
    );
    const pads = block.emits.filter((e) => e.channel === "planted.pads");
    expect(pads).toHaveLength(1);
    expect(pads[0]?.value).toEqual([{ id: "site-1", name: "Site One" }]);
    // Not named by that profile, so the scene keeps its own identity.
    expect(
      block.emits.find((e) => e.channel === "vessel.identity")?.value,
    ).toEqual({ vesselId: "v1" });
  });

  it("takes an absent Uplink's channels off the wire entirely", () => {
    const block = applyInstallProfile(getInstallProfile("stock-career"), SCENE);
    expect(block.emits.some((e) => e.channel === "planted.available")).toBe(
      false,
    );
  });

  it("leaves the scene it was handed untouched", () => {
    applyInstallProfile(getInstallProfile("stock-career"), SCENE);
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
    expect(stock.uplinks[0]).toMatchObject({
      id: "planted",
      available: false,
      health: { state: 2, detail: "Planted mod assembly not loaded" },
    });
    const live = systemUplinksPayload(
      getInstallProfile("planted-space-centre"),
    );
    expect(live.uplinks[0]).toMatchObject({ health: { state: 0 } });
  });

  it("names the known profiles when asked for one that does not exist", () => {
    expect(() => getInstallProfile("no-such-install")).toThrow(/stock-career/);
  });
});
