import { describe, expect, it, vi } from "vitest";
import { modChannelsRule, prereleasePinRule } from "../check/rules/manifest";
import type { CheckContext } from "../check/types";
import { onMain, prereleasePinFault, prereleasePins } from "./pins";
import { uplinkOn } from "./uplink-on";

const mod = (extra: Record<string, unknown>) => ({
  id: "x",
  mod: { name: "X", tier: "ckan", builtAgainst: "1.0.0", ...extra },
});

const context = (dir: string): CheckContext =>
  ({ clientDir: `${dir}/client` }) as CheckContext;

describe("prereleasePins", () => {
  it("finds a prerelease in the mod pin, the CKAN spelling, a minimum and a package", () => {
    const dir = uplinkOn(
      {
        ...mod({
          builtAgainst: "1.11.0-rc.10",
          ckanVersion: "1.11.0-rc.10",
          packages: ["@example/pkg"],
        }),
        ckanDepends: [{ name: "Harmony2", min_version: "2.0.0-beta" }],
      },
      { dependencies: { "@example/pkg": "1.11.0-rc.10" } },
    );
    expect(prereleasePins(dir)).toHaveLength(4);
    expect(prereleasePinFault(dir)).toContain("never a pin in a release");
  });

  it("finds nothing in release pins, and a tag pin is not a prerelease", () => {
    const dir = uplinkOn(mod({ builtAgainst: "2026081218-Levi-Civita" }));
    expect(prereleasePins(dir)).toEqual([]);
    expect(prereleasePinFault(dir)).toBeUndefined();
  });
});

describe("manifest/prerelease-pin", () => {
  const rc = () => uplinkOn(mod({ builtAgainst: "1.11.0-rc.10" }));

  it("is an error on main", () => {
    vi.stubEnv("GITHUB_BASE_REF", "main");
    const found = prereleasePinRule.check(context(rc()));
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ severity: "error" });
    vi.unstubAllEnvs();
  });

  it("is a warning on staging, where a candidate may be tried", () => {
    vi.stubEnv("GITHUB_BASE_REF", "staging");
    const found = prereleasePinRule.check(context(rc()));
    expect(found[0]).toMatchObject({ severity: "warning" });
    vi.unstubAllEnvs();
  });

  it("reads the branch from the environment before git", () => {
    expect(onMain("/", { GITHUB_REF_NAME: "main" })).toBe(true);
    expect(onMain("/", { GITHUB_REF_NAME: "staging" })).toBe(false);
  });
});

describe("manifest/mod-channels", () => {
  it("requires the ckan tier to list CKAN", () => {
    const dir = uplinkOn(mod({ channels: [{ github: "o/r" }] }));
    const found = modChannelsRule.check(context(dir));
    expect(found).toHaveLength(1);
    expect(found[0].message).toContain("CKAN");
  });

  it("accepts CKAN first and a matching ckanVersion", () => {
    const dir = uplinkOn(
      mod({
        channels: [{ ckan: "X" }, { github: "o/r" }],
        ckanVersion: "1:v1.0.0.0",
      }),
    );
    expect(modChannelsRule.check(context(dir))).toEqual([]);
  });

  it("refuses a ckanVersion that is not the pinned release", () => {
    const dir = uplinkOn(
      mod({ channels: [{ ckan: "X" }], ckanVersion: "v1.1.0" }),
    );
    expect(modChannelsRule.check(context(dir))[0].message).toContain(
      "ckanVersion",
    );
  });

  it("reports a malformed channel", () => {
    const dir = uplinkOn(mod({ channels: [{ ckan: "X" }, { bogus: 1 }] }));
    expect(modChannelsRule.check(context(dir))[0].message).toContain(
      "mod.channels[1]",
    );
  });
});
