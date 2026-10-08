import { describe, expect, it, vi } from "vitest";
import { placeholderUrlFault } from "../../../cli/release";
import { PACKAGE_JSON, UPLINK_JSON, uplinkOn } from "../fixture";
import {
  compatDifferences,
  compatRule,
  installedCompat,
  releaseFaultsRule,
} from "./index";

const INSTALLED = { apiVersion: "2.0.0", contractMajor: 1, contractMinor: 4 };
const MANIFEST = (over: Record<string, unknown> = {}) =>
  JSON.stringify({ version: "0.0.1", ...INSTALLED, ...over });

const ctx = (clientDir: string) => ({
  clientDir,
  scan: undefined as never,
  dynamicPrefixes: [],
});

describe("manifest/compat-stale", () => {
  it("passes a manifest written against the installed sdk", () => {
    const { clientDir } = uplinkOn({
      "uplink.json": UPLINK_JSON(),
      "client/gonogo-uplink.json": MANIFEST(),
    });
    const rule = compatRule({ compat: () => INSTALLED });
    expect(rule.check(ctx(clientDir))).toEqual([]);
  });

  it("names each stamp that differs from the installed sdk, and heals with page", () => {
    const { clientDir } = uplinkOn({
      "uplink.json": UPLINK_JSON(),
      "client/gonogo-uplink.json": MANIFEST({
        apiVersion: "1.9.0",
        contractMinor: 2,
      }),
    });
    const heal = vi.fn();
    const [finding] = compatRule({ compat: () => INSTALLED, heal }).check(
      ctx(clientDir),
    );
    expect(finding.rule).toBe("manifest/compat-stale");
    expect(finding.fixable).toBe(true);
    expect(finding.message).toContain('apiVersion is "1.9.0"');
    expect(finding.message).toContain("contractMinor is 2");
    expect(finding.message).not.toContain("contractMajor");
    finding.apply?.();
    expect(heal).toHaveBeenCalledWith(clientDir);
  });

  it("has nothing to compare before a manifest has been written", () => {
    const { clientDir } = uplinkOn({ "uplink.json": UPLINK_JSON() });
    expect(
      compatRule({ compat: () => INSTALLED }).check(ctx(clientDir)),
    ).toEqual([]);
  });

  it("compares numbers by type, so a string stamp is a difference", () => {
    expect(
      compatDifferences({ ...INSTALLED, contractMajor: "1" }, INSTALLED),
    ).toHaveLength(1);
  });

  it("reads the installed sdk's stamps as bundle does", () => {
    const { clientDir } = uplinkOn({ "uplink.json": UPLINK_JSON() });
    const found = installedCompat(clientDir);
    expect(found.apiVersion).toMatch(/^\d+\.\d+\.\d+/);
    expect(Number.isInteger(found.contractMajor)).toBe(true);
    expect(Number.isInteger(found.contractMinor)).toBe(true);
  });
});

describe("manifest release faults", () => {
  const files = (url: string, pkgVersion: string, manifest?: string) => ({
    "uplink.json": UPLINK_JSON({ client: { url } }),
    "client/package.json": PACKAGE_JSON(pkgVersion),
    ...(manifest ? { "client/gonogo-uplink.json": manifest } : {}),
  });

  it("passes a URL and versions that agree", () => {
    const { clientDir } = uplinkOn(
      files(
        "https://cdn.example.com/demo/0.0.1/demo.client.js",
        "0.0.1",
        MANIFEST(),
      ),
    );
    expect(releaseFaultsRule.check(ctx(clientDir))).toEqual([]);
  });

  it("warns about the scaffold's placeholder URL, which release refuses", () => {
    const url = "https://cdn.jsdelivr.net/gh/you/demo/0.0.1/demo.client.js";
    const { clientDir } = uplinkOn(files(url, "0.0.1"));
    const [finding] = releaseFaultsRule.check(ctx(clientDir));
    expect(finding.rule).toBe("manifest/placeholder-url");
    expect(finding.severity).toBe("warning");
    expect(finding.message).toBe(placeholderUrlFault(url));
  });

  it("fails a client URL for another version than package.json's", () => {
    const { clientDir } = uplinkOn(
      files("https://cdn.example.com/demo/0.0.2/demo.client.js", "0.0.1"),
    );
    const [finding] = releaseFaultsRule.check(ctx(clientDir));
    expect(finding.rule).toBe("manifest/url-version");
    expect(finding.severity).toBe("error");
    expect(finding.message).toContain("0.0.2");
  });

  it("fails a manifest that declares another version than package.json's", () => {
    const { clientDir } = uplinkOn(
      files(
        "https://cdn.example.com/demo/0.0.1/demo.client.js",
        "0.0.1",
        MANIFEST({ version: "0.0.3" }),
      ),
    );
    const [finding] = releaseFaultsRule.check(ctx(clientDir));
    expect(finding.rule).toBe("manifest/version");
    expect(finding.message).toContain("0.0.3");
  });

  it("is the same function release calls for the placeholder", () => {
    expect(placeholderUrlFault("https://example.com/real")).toBeUndefined();
    expect(placeholderUrlFault("")).toBeUndefined();
  });
});
