import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PACKAGE_JSON, UPLINK_JSON, uplinkOn } from "../fixture";
import { pageRule } from "./index";

const CHECK_TEST = `import { expectUplinkPageCurrent } from "@ksp-gonogo/uplink-tools/page-check";
it("is current", () => { expectUplinkPageCurrent(); });
`;

const client = (withCheck: boolean) => {
  const made = uplinkOn({
    "uplink.json": UPLINK_JSON(),
    "client/package.json": PACKAGE_JSON(),
    ...(withCheck ? { "client/src/uplink-page.test.ts": CHECK_TEST } : {}),
  });
  mkdirSync(join(made.clientDir, "node_modules"));
  return made;
};

describe("page/stale", () => {
  it("passes when the page check passes", () => {
    const { clientDir } = client(true);
    const rule = pageRule(() => ({ status: 0, output: "" }));
    expect(
      rule.check({ clientDir, scan: undefined as never, dynamicPrefixes: [] }),
    ).toEqual([]);
  });

  it("fails, fixably, when the page check fails, and says what differs", () => {
    const { clientDir } = client(true);
    const rule = pageRule(() => ({
      status: 1,
      output:
        'FAIL x\n  README.md differs at line 3:\n      committed: "a"\n      generated: "b"\n',
    }));
    const [finding] = rule.check({
      clientDir,
      scan: undefined as never,
      dynamicPrefixes: [],
    });
    expect(finding.rule).toBe("page/stale");
    expect(finding.severity).toBe("error");
    expect(finding.fixable).toBe(true);
    expect(finding.message).toContain("README.md differs at line 3");
    expect(finding.fix).toContain("uplink-tools page");
  });

  it("hands the page check only the test files that call it", () => {
    const { clientDir } = client(true);
    let given: readonly string[] = [];
    pageRule((_dir, files) => {
      given = files;
      return { status: 0, output: "" };
    }).check({ clientDir, scan: undefined as never, dynamicPrefixes: [] });
    expect(given.map((file) => file.split("/").pop())).toEqual([
      "uplink-page.test.ts",
    ]);
  });

  it("reports an Uplink with no page check at all", () => {
    const { clientDir } = client(false);
    const [finding] = pageRule(() => ({ status: 0, output: "" })).check({
      clientDir,
      scan: undefined as never,
      dynamicPrefixes: [],
    });
    expect(finding.rule).toBe("page/no-check");
    expect(finding.fixable).toBe(false);
  });

  it("has nothing to say about a client that is not an Uplink's", () => {
    const { clientDir } = uplinkOn({ "client/package.json": PACKAGE_JSON() });
    expect(
      pageRule(() => ({ status: 1, output: "" })).check({
        clientDir,
        scan: undefined as never,
        dynamicPrefixes: [],
      }),
    ).toEqual([]);
  });
});
