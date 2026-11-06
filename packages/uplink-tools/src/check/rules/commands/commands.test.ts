import { describe, expect, it } from "vitest";
import { PACKAGE_JSON, uplinkOn } from "../fixture";
import {
  SEND_WITHOUT_INPUT_FIX,
  SEND_WITHOUT_INPUT_MESSAGE,
  sendWithoutInputRule,
} from "./index";

const ctx = (clientDir: string) => ({
  clientDir,
  scan: undefined as never,
  dynamicPrefixes: [],
});
const check = (files: Record<string, string>) => {
  const { clientDir } = uplinkOn({
    "client/package.json": PACKAGE_JSON(),
    ...Object.fromEntries(
      Object.entries(files).map(([name, text]) => [`client/src/${name}`, text]),
    ),
  });
  return sendWithoutInputRule.check(ctx(clientDir));
};

describe("commands/send-without-input", () => {
  it("passes a client that never names the send", () => {
    expect(check({ "a.ts": `export const x = cmd.with({});\n` })).toEqual([]);
  });

  it("warns, never errors, with the line and the fix", () => {
    const [finding] = check({
      "a.tsx": `const a = 1;\nexport const W = () => <b onClick={() => void cmd.dangerouslySendWithoutInput({})}>x</b>;\n`,
    });
    expect(finding.severity).toBe("warning");
    expect(finding.line).toBe(2);
    expect(finding.message).toBe(SEND_WITHOUT_INPUT_MESSAGE);
    expect(finding.fix).toBe(SEND_WITHOUT_INPUT_FIX);
    expect(finding.fixable).toBe(false);
  });

  it.each([
    ["a destructure", `const { dangerouslySendWithoutInput } = cmd;`],
    ["an alias", `const s = cmd.dangerouslySendWithoutInput;`],
    ["an element access", `cmd["dangerouslySendWithoutInput"]({});`],
  ])("sees %s", (_name, source) => {
    expect(check({ "a.ts": source })).toHaveLength(1);
  });

  it("leaves test files alone", () => {
    expect(
      check({ "a.test.ts": `cmd.dangerouslySendWithoutInput({});` }),
    ).toEqual([]);
  });
});
