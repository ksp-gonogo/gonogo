import { afterEach, describe, expect, it, vi } from "vitest";
import { sha256HexFallback } from "./sha256-fallback";
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

const VECTORS: Array<[string, string]> = [
  ["", "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"],
  ["abc", "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"],
  [
    "abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq",
    "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1",
  ],
];

describe("sha256Integrity", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("writes the digest in the form a manifest's integrity holds", async () => {
    const bytes = new TextEncoder().encode("abc").buffer as ArrayBuffer;
    expect(await sha256Integrity(bytes)).toBe(`sha256-${VECTORS[1][1]}`);
  });

  it("gives the same digest on a page with no Web Crypto", async () => {
    vi.stubGlobal("crypto", undefined);
    for (const [text, hex] of VECTORS) {
      const bytes = new TextEncoder().encode(text).buffer as ArrayBuffer;
      expect(await sha256Integrity(bytes)).toBe(`sha256-${hex}`);
    }
  });
});

describe("sha256HexFallback", () => {
  it("matches the published vectors", () => {
    for (const [text, hex] of VECTORS) {
      expect(sha256HexFallback(new TextEncoder().encode(text))).toBe(hex);
    }
  });

  it("matches crypto.subtle across lengths that straddle block padding", async () => {
    for (const length of [1, 55, 56, 63, 64, 65, 119, 120, 128, 1000, 70000]) {
      const bytes = new Uint8Array(length);
      for (let i = 0; i < length; i++) bytes[i] = (i * 31 + 7) & 0xff;
      const digest = await crypto.subtle.digest("SHA-256", bytes);
      const hex = Array.from(new Uint8Array(digest), (b) =>
        b.toString(16).padStart(2, "0"),
      ).join("");
      expect(sha256HexFallback(bytes)).toBe(hex);
    }
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
