import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { staleInstallFault } from "./stale-install";

const SDK = "@ksp-gonogo/sitrep-sdk";

/** A client package asking for `pin`, with `installed` sitting in its node_modules. */
const client = (pin: string, installed: string) => {
  const dir = mkdtempSync(join(tmpdir(), "stale-install-"));
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({ name: "c", devDependencies: { [SDK]: pin } }),
  );
  const pkg = join(dir, "node_modules", "@ksp-gonogo", "sitrep-sdk");
  mkdirSync(pkg, { recursive: true });
  writeFileSync(
    join(pkg, "package.json"),
    JSON.stringify({ name: SDK, version: installed }),
  );
  return { dir, pkg };
};

describe("staleInstallFault", () => {
  it("names the installed and the pinned version and says to reinstall", () => {
    const { dir, pkg } = client("^6.0.0", "5.2.0");
    const fault = staleInstallFault(dir, pkg);
    expect(fault).toContain("5.2.0");
    expect(fault).toContain("^6.0.0");
    expect(fault).toMatch(/npm install/);
  });

  it("is silent when the install satisfies the pin", () => {
    const { dir, pkg } = client("^6.0.0", "6.1.0");
    expect(staleInstallFault(dir, pkg)).toBeUndefined();
  });

  it("is silent for a pin it cannot read as a version", () => {
    const { dir, pkg } = client("workspace:*", "0.0.0");
    expect(staleInstallFault(dir, pkg)).toBeUndefined();
  });

  it("compares a prerelease install by its release numbers", () => {
    const { dir, pkg } = client("6.0.0-rc.2", "6.0.0-rc.1");
    expect(staleInstallFault(dir, pkg)).toBeUndefined();
  });
});
