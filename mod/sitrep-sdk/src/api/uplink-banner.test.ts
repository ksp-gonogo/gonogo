import { afterEach, describe, expect, it } from "vitest";
import {
  clearRaisedBanners,
  getRaisedBanners,
  installTestHost,
  resetTestHost,
} from "../testing";
import {
  recordClearedBanner,
  recordRaisedBanner,
} from "../testing/recorded-uplink-banners";
import type { UplinkClientHandle } from "./types";
import { clearUplinkBanner, raiseUplinkBanner } from "./uplink-banner";

const OWNER = { id: "banner-sdk", name: "Banner SDK" } as UplinkClientHandle;

afterEach(() => {
  clearRaisedBanners();
  resetTestHost();
});

describe("uplink banners", () => {
  it("records a raised banner with its Uplink, updates by id, and forgets a cleared one", () => {
    installTestHost({
      raiseUplinkBanner: recordRaisedBanner,
      clearUplinkBanner: recordClearedBanner,
    });
    const owner = OWNER;
    raiseUplinkBanner(owner, { id: "a", severity: "info", text: "one" });
    raiseUplinkBanner(owner, { id: "a", severity: "critical", text: "two" });
    expect(getRaisedBanners()).toEqual([
      { id: "a", severity: "critical", text: "two", uplinkId: "banner-sdk" },
    ]);
    clearUplinkBanner(owner, "a");
    expect(getRaisedBanners()).toEqual([]);
  });

  it("fails loudly with no host installed", () => {
    resetTestHost();
    const owner = OWNER;
    expect(() =>
      raiseUplinkBanner(owner, { id: "a", severity: "info", text: "x" }),
    ).toThrow(/host has not been installed/);
  });
});
