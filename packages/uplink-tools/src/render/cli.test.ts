// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { rendersIntoPackage, run } from "./cli";

afterEach(() => {
  vi.restoreAllMocks();
});

async function refusal(argv: string[]): Promise<string> {
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  const code = await run(argv);
  expect(code).toBe(1);
  return error.mock.calls.map((call) => String(call[0])).join("\n");
}

describe("docs --no-assets", () => {
  it("renders into a scratch directory, so the committed images are never rewritten", () => {
    expect(rendersIntoPackage({ check: false, noAssets: true })).toBe(false);
  });

  it("leaves a plain docs run writing its renders into the package", () => {
    expect(rendersIntoPackage({ check: false, noAssets: false })).toBe(true);
  });

  it("keeps --check out of the package as before", () => {
    expect(rendersIntoPackage({ check: true, noAssets: false })).toBe(false);
  });

  it("refuses to combine with --check, which writes nothing to leave out", async () => {
    expect(await refusal(["docs", "--no-assets", "--check"])).toMatch(
      /--no-assets and --check do not combine/,
    );
  });

  it("refuses render, which has no prose to regenerate", async () => {
    expect(await refusal(["render", "--no-assets"])).toMatch(
      /--no-assets only applies to docs/,
    );
  });
});
