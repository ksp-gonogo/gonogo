import { describe, expect, it, vi } from "vitest";
import { PACKAGE_JSON, UPLINK_JSON, uplinkOn } from "../fixture";
import { codegenRule } from "./index";

const ctx = (clientDir: string) => ({
  clientDir,
  scan: undefined as never,
  dynamicPrefixes: [],
});
const WITH_SLICE = UPLINK_JSON({
  codegen: {
    assembly: "GonogoDemoUplink.Contract",
    configurationMethod: "Configure",
    emits: {},
  },
});
const sliced = () =>
  uplinkOn({
    "uplink.json": WITH_SLICE,
    "client/package.json": PACKAGE_JSON(),
  });

describe("codegen/stale", () => {
  it("passes when codegen --check passes", () => {
    const { clientDir } = sliced();
    const generate = vi.fn();
    const rule = codegenRule({ hasDotnet: () => true, generate });
    expect(rule.check(ctx(clientDir))).toEqual([]);
    expect(generate).toHaveBeenCalledWith(expect.any(String), true);
  });

  it("fails with codegen's own words when the committed files differ, and heals by writing them", () => {
    const { clientDir } = sliced();
    const generate = vi.fn((_dir: string, check: boolean) => {
      if (check) throw new Error("stale or missing: contract.ts");
    });
    const rule = codegenRule({ hasDotnet: () => true, generate });
    const [finding] = rule.check(ctx(clientDir));
    expect(finding.rule).toBe("codegen/stale");
    expect(finding.severity).toBe("error");
    expect(finding.fixable).toBe(true);
    expect(finding.message).toContain("stale or missing: contract.ts");
    finding.apply?.();
    expect(generate).toHaveBeenLastCalledWith(expect.any(String), false);
  });

  it("reports skipped, never nothing, when dotnet is absent", () => {
    const { clientDir } = sliced();
    const generate = vi.fn();
    const findings = codegenRule({ hasDotnet: () => false, generate }).check(
      ctx(clientDir),
    );
    expect(findings).toHaveLength(1);
    expect(findings[0].rule).toBe("codegen/skipped");
    expect(findings[0].message).toContain("proves less than a full one");
    expect(generate).not.toHaveBeenCalled();
  });

  it("is absent for an Uplink with no contract slice of its own", () => {
    const { clientDir } = uplinkOn({
      "uplink.json": UPLINK_JSON(),
      "client/package.json": PACKAGE_JSON(),
    });
    const generate = vi.fn();
    expect(
      codegenRule({ hasDotnet: () => false, generate }).check(ctx(clientDir)),
    ).toEqual([]);
    expect(generate).not.toHaveBeenCalled();
  });
});
