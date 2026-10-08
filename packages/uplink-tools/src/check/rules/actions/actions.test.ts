import { describe, expect, it } from "vitest";
import { PACKAGE_JSON, uplinkOn } from "../fixture";
import { actionIdRule, KEBAB_CASE, toKebab } from "./index";

const check = (files: Record<string, string>) => {
  const { clientDir } = uplinkOn({
    "client/package.json": PACKAGE_JSON(),
    ...Object.fromEntries(
      Object.entries(files).map(([name, text]) => [`client/src/${name}`, text]),
    ),
  });
  return actionIdRule.check({
    clientDir,
    scan: undefined as never,
    dynamicPrefixes: [],
  });
};

describe("actions/kebab-case", () => {
  it("passes kebab-case ids", () => {
    expect(
      check({
        "w.tsx": `registerComponent({ id: "w", actions: [{ id: "rpm-up", label: "Up" }, { id: "toggle-motor-2" }] });`,
      }),
    ).toEqual([]);
  });

  it("fails a camelCase id as an error, with the line and the new spelling", () => {
    const [finding] = check({
      "w.tsx": `registerComponent({\n  id: "w",\n  actions: [\n    { id: "rpmUp" },\n  ],\n});`,
    });
    expect(finding.rule).toBe("actions/kebab-case");
    expect(finding.severity).toBe("error");
    expect(finding.fixable).toBe(false);
    expect(finding.line).toBe(4);
    expect(finding.fix).toContain('"rpm-up"');
    expect(finding.fix).toContain("Bindings saved under the old id are lost");
  });

  it("fails snake_case and uppercase ids", () => {
    const findings = check({
      "w.ts": `export const c = { actions: [{ id: "toggle_motor" }, { id: "Reverse" }] };`,
    });
    expect(findings.map((f) => f.message.match(/"(.+?)"/)?.[1])).toEqual([
      "toggle_motor",
      "Reverse",
    ]);
  });

  it("follows a const array in the same file and sees through as const satisfies", () => {
    const [finding] = check({
      "w.tsx": `const ACTIONS = [{ id: "badId" }] as const satisfies readonly ActionDefinition[];\nregisterComponent({ id: "w", actions: ACTIONS });`,
    });
    expect(finding.message).toContain("badId");
  });

  it("reads an array typed as ActionDefinition where it is declared, for another file to hand over", () => {
    const [finding] = check({
      "actions.ts": `export const rotorActions = [{ id: "rpmUp", label: "x" }] as const satisfies readonly ActionDefinition[];`,
    });
    expect(finding.message).toContain("rpmUp");
  });

  it("does not take an id elsewhere for an action's", () => {
    expect(
      check({
        "w.tsx": `registerComponent({ id: "myWidget", channels: ["vessel.flight"] });\nconst other = { id: "someThing" };`,
      }),
    ).toEqual([]);
  });

  it("spells kebab-case one way", () => {
    expect(KEBAB_CASE.test("rpm-up")).toBe(true);
    expect(KEBAB_CASE.test("rpm--up")).toBe(false);
    expect(KEBAB_CASE.test("rpmUp")).toBe(false);
    expect(toKebab("rpmUp")).toBe("rpm-up");
    expect(toKebab("toggle_motor")).toBe("toggle-motor");
  });
});
