import { describe, expect, it } from "vitest";
import {
  type AppCompatIdentity,
  checkUplinkCompat,
  EXTENSION_API_VERSION,
  type GonogoUplinkManifest,
  isGonogoUplinkManifest,
  parseUplinkManifest,
} from "./uplinkVersionCompat";

function manifest(
  overrides: Partial<GonogoUplinkManifest> = {},
): GonogoUplinkManifest {
  return {
    id: "test-uplink",
    version: "1.0.0",
    minAppVersion: "1.0.0",
    apiVersion: "1.0.0",
    uiKitVersion: "1.2.0",
    contractMajor: 4,
    contractMinor: 3,
    integrity: "sha256-deadbeef",
    ...overrides,
  };
}

function app(overrides: Partial<AppCompatIdentity> = {}): AppCompatIdentity {
  return {
    apiVersion: "1.0.0",
    uiKitVersion: "1.2.0",
    contractMajor: 4,
    contractMinor: 3,
    appVersion: "2.0.0",
    ...overrides,
  };
}

describe("EXTENSION_API_VERSION", () => {
  it("is the hand-managed 1.0.0 gate, not core's package.json placeholder", () => {
    expect(EXTENSION_API_VERSION).toBe("1.0.0");
  });
});

describe("checkUplinkCompat: apiVersion", () => {
  it("refuses on a major mismatch", () => {
    const result = checkUplinkCompat(
      manifest({ apiVersion: "2.0.0" }),
      app({ apiVersion: "1.5.0" }),
    );
    expect(result.verdict).toBe("refuse");
    expect(result.reason).toMatch(/apiVersion major mismatch/);
  });

  it("refuses when client minor is newer than the app's", () => {
    const result = checkUplinkCompat(
      manifest({ apiVersion: "1.5.0" }),
      app({ apiVersion: "1.2.0" }),
    );
    expect(result.verdict).toBe("refuse");
    expect(result.reason).toMatch(/apiVersion minor too new/);
  });

  it("loads when client minor is older than the app's", () => {
    const result = checkUplinkCompat(
      manifest({ apiVersion: "1.1.0" }),
      app({ apiVersion: "1.5.0" }),
    );
    expect(result.verdict).toBe("load");
  });

  it("loads when apiVersion is exactly equal", () => {
    const result = checkUplinkCompat(
      manifest({ apiVersion: "1.3.0" }),
      app({ apiVersion: "1.3.0" }),
    );
    expect(result.verdict).toBe("load");
  });
});

describe("checkUplinkCompat: uiKitVersion", () => {
  it("0.x: refuses on a minor mismatch (exact-minor regime)", () => {
    const result = checkUplinkCompat(
      manifest({ uiKitVersion: "0.2.0" }),
      app({ uiKitVersion: "0.1.0" }),
    );
    expect(result.verdict).toBe("refuse");
    expect(result.reason).toMatch(/uiKitVersion 0\.x minor mismatch/);
  });

  it("0.x: loads on an exact minor match", () => {
    const result = checkUplinkCompat(
      manifest({ uiKitVersion: "0.1.0" }),
      app({ uiKitVersion: "0.1.0" }),
    );
    expect(result.verdict).toBe("load");
  });

  it("0.x: refuses when the client isn't 0.x at all against a 0.x app (defensive major check)", () => {
    const result = checkUplinkCompat(
      manifest({ uiKitVersion: "1.0.0" }),
      app({ uiKitVersion: "0.1.0" }),
    );
    expect(result.verdict).toBe("refuse");
    expect(result.reason).toMatch(/uiKitVersion 0\.x minor mismatch/);
  });

  it("1.x: refuses on a major mismatch", () => {
    const result = checkUplinkCompat(
      manifest({ uiKitVersion: "2.0.0" }),
      app({ uiKitVersion: "1.2.0" }),
    );
    expect(result.verdict).toBe("refuse");
    expect(result.reason).toMatch(/uiKitVersion major mismatch/);
  });

  it("1.x: refuses when client minor is newer than the app's", () => {
    const result = checkUplinkCompat(
      manifest({ uiKitVersion: "1.5.0" }),
      app({ uiKitVersion: "1.2.0" }),
    );
    expect(result.verdict).toBe("refuse");
    expect(result.reason).toMatch(/uiKitVersion minor too new/);
  });

  it("1.x: loads when client minor is older than or equal to the app's", () => {
    expect(
      checkUplinkCompat(
        manifest({ uiKitVersion: "1.0.0" }),
        app({ uiKitVersion: "1.2.0" }),
      ).verdict,
    ).toBe("load");
    expect(
      checkUplinkCompat(
        manifest({ uiKitVersion: "1.2.0" }),
        app({ uiKitVersion: "1.2.0" }),
      ).verdict,
    ).toBe("load");
  });
});

describe("checkUplinkCompat: contractMajor", () => {
  it("refuses on any mismatch", () => {
    const result = checkUplinkCompat(
      manifest({ contractMajor: 3 }),
      app({ contractMajor: 4 }),
    );
    expect(result.verdict).toBe("refuse");
    expect(result.reason).toMatch(/contractMajor mismatch/);
  });

  it("loads when equal", () => {
    const result = checkUplinkCompat(
      manifest({ contractMajor: 4 }),
      app({ contractMajor: 4 }),
    );
    expect(result.verdict).toBe("load");
  });
});

describe("checkUplinkCompat: contractMinor", () => {
  it("refuses when client is newer than the app's", () => {
    const result = checkUplinkCompat(
      manifest({ contractMinor: 5 }),
      app({ contractMinor: 3 }),
    );
    expect(result.verdict).toBe("refuse");
    expect(result.reason).toMatch(/contractMinor too new/);
  });

  it("loads when client is older than or equal to the app's", () => {
    expect(
      checkUplinkCompat(
        manifest({ contractMinor: 2 }),
        app({ contractMinor: 3 }),
      ).verdict,
    ).toBe("load");
    expect(
      checkUplinkCompat(
        manifest({ contractMinor: 3 }),
        app({ contractMinor: 3 }),
      ).verdict,
    ).toBe("load");
  });
});

describe("checkUplinkCompat: minAppVersion", () => {
  it("warn-loads when the running app is older than the advisory floor", () => {
    const result = checkUplinkCompat(
      manifest({ minAppVersion: "2.5.0" }),
      app({ appVersion: "2.0.0" }),
    );
    expect(result.verdict).toBe("warn-load");
    expect(result.reason).toMatch(/minAppVersion 2\.5\.0 > app 2\.0\.0/);
  });

  it("loads when the running app meets or exceeds the floor", () => {
    expect(
      checkUplinkCompat(
        manifest({ minAppVersion: "1.9.0" }),
        app({ appVersion: "2.0.0" }),
      ).verdict,
    ).toBe("load");
    expect(
      checkUplinkCompat(
        manifest({ minAppVersion: "2.0.0" }),
        app({ appVersion: "2.0.0" }),
      ).verdict,
    ).toBe("load");
  });
});

describe("checkUplinkCompat: verdict precedence", () => {
  it("refuse wins over warn-load when a manifest trips both", () => {
    // apiVersion major mismatch (refuse) AND minAppVersion above the running
    // app (would otherwise warn-load) — refuse must win.
    const result = checkUplinkCompat(
      manifest({ apiVersion: "9.0.0", minAppVersion: "5.0.0" }),
      app({ apiVersion: "1.0.0", appVersion: "2.0.0" }),
    );
    expect(result.verdict).toBe("refuse");
    expect(result.reason).toMatch(/apiVersion major mismatch/);
  });

  it("checks apiVersion before uiKitVersion when both would refuse", () => {
    const result = checkUplinkCompat(
      manifest({ apiVersion: "9.0.0", uiKitVersion: "9.0.0" }),
      app({ apiVersion: "1.0.0", uiKitVersion: "1.2.0" }),
    );
    expect(result.verdict).toBe("refuse");
    expect(result.reason).toMatch(/^apiVersion/);
  });

  it("a fully-compatible manifest loads with reason 'compatible'", () => {
    const result = checkUplinkCompat(manifest(), app());
    expect(result).toEqual({ verdict: "load", reason: "compatible" });
  });
});

describe("isGonogoUplinkManifest", () => {
  it("accepts a valid manifest", () => {
    expect(isGonogoUplinkManifest(manifest())).toBe(true);
  });

  it("rejects a manifest missing a field", () => {
    const { integrity: _integrity, ...rest } = manifest();
    expect(isGonogoUplinkManifest(rest)).toBe(false);
  });

  it("rejects a manifest with a mistyped field", () => {
    expect(isGonogoUplinkManifest({ ...manifest(), contractMajor: "4" })).toBe(
      false,
    );
  });

  it("rejects non-objects", () => {
    expect(isGonogoUplinkManifest(null)).toBe(false);
    expect(isGonogoUplinkManifest(undefined)).toBe(false);
    expect(isGonogoUplinkManifest("not an object")).toBe(false);
    expect(isGonogoUplinkManifest(42)).toBe(false);
  });
});

describe("parseUplinkManifest", () => {
  it("parses a valid JSON string", () => {
    const m = manifest();
    expect(parseUplinkManifest(JSON.stringify(m))).toEqual(m);
  });

  it("passes through an already-parsed valid manifest", () => {
    const m = manifest();
    expect(parseUplinkManifest(m)).toEqual(m);
  });

  it("throws on malformed JSON", () => {
    expect(() => parseUplinkManifest("{not json")).toThrow(/invalid JSON/);
  });

  it("throws a clear error on a missing/wrong-typed field", () => {
    const { integrity: _integrity, ...rest } = manifest();
    expect(() => parseUplinkManifest(rest)).toThrow(
      /malformed Uplink manifest/,
    );
    expect(() =>
      parseUplinkManifest({ ...manifest(), contractMinor: "3" }),
    ).toThrow(/malformed Uplink manifest/);
  });
});
