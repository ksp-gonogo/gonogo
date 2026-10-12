import { describe, expect, it } from "vitest";
import {
  checkUplinkCompat,
  parseSemver,
  parseUplinkManifest,
  sha256Integrity,
} from "./uplink-load";

const manifest = {
  id: "demo",
  version: "1.0.0",
  minAppVersion: "1.0.0",
  apiVersion: "3.0.0",
  contractMajor: 40,
  contractMinor: 0,
  integrity: "sha256-00",
};

describe("sha256Integrity", () => {
  it("writes the digest in the form a manifest's integrity holds", async () => {
    const bytes = new TextEncoder().encode("abc").buffer as ArrayBuffer;
    expect(await sha256Integrity(bytes)).toBe(
      "sha256-ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });
});

describe("the gates a host runs", () => {
  it("reads a manifest and gates it against the host's numbers", () => {
    const read = parseUplinkManifest(JSON.stringify(manifest));
    const host = {
      apiVersion: "3.0.0",
      contractMajor: 40,
      contractMinor: 0,
      appVersion: "2.0.0",
    };
    expect(checkUplinkCompat(read, host).verdict).toBe("load");
    expect(
      checkUplinkCompat({ ...read, contractMajor: 39 }, host).verdict,
    ).toBe("refuse");
  });

  it("refuses a manifest with a field missing, naming the fields", () => {
    expect(() => parseUplinkManifest({ id: "demo" })).toThrow(/missing or/);
  });

  it("drops a pre-release suffix and refuses what is not a version", () => {
    expect(parseSemver("2.0.0-rc.3")).toEqual({ major: 2, minor: 0, patch: 0 });
    expect(parseSemver("latest")).toBeNull();
  });
});
