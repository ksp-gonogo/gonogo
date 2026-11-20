// @vitest-environment node
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { checkUplinkCompat, type GonogoUplinkManifest } from "@ksp-gonogo/core";
import { CONTRACT_MAJOR, CONTRACT_MINOR } from "@ksp-gonogo/sitrep-sdk";
import { describe, expect, it } from "vitest";
import { hostCompat } from "./hostCompat";

/**
 * What the v1.0.0 tag's `compat-versions.ts` carries: the numbers a client
 * built against the 1.0.0 sdk and ui-kit writes into its manifest.
 */
const BUILT_AGAINST_1_0_0 = {
  apiVersion: "7.0.0",
  contractMajor: 52,
  contractMinor: 2,
};

const REPO_ROOT = join(import.meta.dirname, "..", "..", "..", "..");

const appVersion: string = JSON.parse(
  readFileSync(join(REPO_ROOT, "packages/app/package.json"), "utf8"),
).version;

const manifest: GonogoUplinkManifest = {
  id: "built-for-1-0-0",
  version: "1.0.0",
  minAppVersion: "1.0.0",
  integrity: "sha256-deadbeef",
  ...BUILT_AGAINST_1_0_0,
};

const host = {
  apiVersion: hostCompat.apiVersion,
  contractMajor: CONTRACT_MAJOR,
  contractMinor: CONTRACT_MINOR,
  appVersion,
};

interface LedgerFile {
  pending: { breaks: { key: string }[] };
}

const pendingBreaks = (): string[] => {
  const ledger: LedgerFile = JSON.parse(
    readFileSync(
      join(REPO_ROOT, "mod/sitrep-sdk/extension-api.ledger.json"),
      "utf8",
    ),
  );
  return ledger.pending.breaks.map((change) => change.key);
};

describe("an Uplink client built against the 1.0.0 sdk and ui-kit", () => {
  it("still passes the host's compat gate on this tree", () => {
    expect(checkUplinkCompat(manifest, host).verdict).not.toBe("refuse");
  });

  it("is still accepted after the release that freezes the pending surface changes", () => {
    const breaks = pendingBreaks();
    expect(
      breaks,
      `the pending ledger counts these as breaks, so the release would move the extension API major and the app would refuse every 1.0 Uplink: ${breaks.join(", ")}`,
    ).toEqual([]);
    const [major, minor] = hostCompat.apiVersion.split(".").map(Number);
    const afterRelease = `${major}.${minor + 1}.0`;
    expect(
      checkUplinkCompat(manifest, { ...host, apiVersion: afterRelease })
        .verdict,
    ).not.toBe("refuse");
  });

  it("is refused once the major moves, so the check above can fail", () => {
    const [major] = hostCompat.apiVersion.split(".").map(Number);
    expect(
      checkUplinkCompat(manifest, { ...host, apiVersion: `${major + 1}.0.0` })
        .verdict,
    ).toBe("refuse");
  });
});
