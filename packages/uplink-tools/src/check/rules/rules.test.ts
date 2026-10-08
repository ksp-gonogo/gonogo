import { describe, expect, it, vi } from "vitest";
import { check } from "../command";
import { PACKAGE_JSON, UPLINK_JSON, uplinkOn } from "./fixture";

const ruleIds = (json: string): string[] => {
  const parsed: unknown = JSON.parse(json);
  return Array.isArray(parsed)
    ? parsed.map((finding) => String(Reflect.get(finding, "rule")))
    : [];
};

const run = async (clientDir: string, args: string[]) => {
  const out: string[] = [];
  vi.spyOn(console, "log").mockImplementation((line: unknown) => {
    out.push(String(line));
  });
  const code = await check(
    ["--client", clientDir, "--json", ...args],
    clientDir,
    {},
  );
  vi.restoreAllMocks();
  return { code, findings: ruleIds(out.join("\n")) };
};

describe("the wrapper rules through check", () => {
  it("fails a client carrying a private import and a camelCase action id, naming each rule", async () => {
    const { clientDir } = uplinkOn({
      "uplink.json": UPLINK_JSON(),
      "client/package.json": PACKAGE_JSON(),
      "client/tsconfig.json": JSON.stringify({ include: ["src"] }),
      "client/src/index.ts": `import { a } from "@ksp-gonogo/core";\nexport const w = { actions: [{ id: "rpmUp" }], a };\n`,
    });
    const { code, findings } = await run(clientDir, [
      "--only",
      "imports,actions",
    ]);
    expect(code).toBe(1);
    expect(findings.sort()).toEqual([
      "actions/kebab-case",
      "imports/private-package",
    ]);
  });

  it("passes the same client once both are fixed", async () => {
    const { clientDir } = uplinkOn({
      "uplink.json": UPLINK_JSON(),
      "client/package.json": PACKAGE_JSON(),
      "client/tsconfig.json": JSON.stringify({ include: ["src"] }),
      "client/src/index.ts": `import { a } from "@ksp-gonogo/sitrep-sdk";\nexport const w = { actions: [{ id: "rpm-up" }], a };\n`,
    });
    const { code, findings } = await run(clientDir, [
      "--only",
      "imports,actions,plugin",
    ]);
    expect(findings).toEqual([]);
    expect(code).toBe(0);
  });
});
