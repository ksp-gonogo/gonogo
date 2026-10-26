import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { deps } from "./command";
import { recordedHttp } from "./recorded";
import { uplinkOn } from "./uplink-on";

const uplink = (builtAgainst: string) => ({
  id: "ex1",
  mod: {
    name: "Example-1",
    tier: "ckan",
    ckan: "Example-1",
    builtAgainst,
    channels: [{ ckan: "Example-1" }],
  },
});

afterEach(() => vi.restoreAllMocks());

function captured(): () => string {
  let out = "";
  vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
    out += String(chunk);
    return true;
  });
  return () => out;
}

describe("uplink-tools deps", () => {
  it("exits 10 when something is behind and prints the report as JSON", async () => {
    const out = captured();
    const code = await deps(["--json"], uplinkOn(uplink("4.7.0.0")), {
      http: recordedHttp(),
    });
    expect(code).toBe(10);
    expect(JSON.parse(out()).schema).toBe("uplink-deps/1");
  });

  it("exits 0 when nothing is behind", async () => {
    captured();
    const code = await deps([], uplinkOn(uplink("4.8.1.0")), {
      http: recordedHttp(),
    });
    expect(code).toBe(0);
  });

  it("exits 2 when a channel cannot be read", async () => {
    captured();
    const code = await deps([], uplinkOn(uplink("4.7.0.0")), {
      http: recordedHttp({}),
    });
    expect(code).toBe(2);
  });

  it("writes the bump result to the file named and exits 3 for an unverified one", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const dir = uplinkOn(uplink("4.7.0.0"));
    const result = join(dir, "out", "result.json");
    const code = await deps(["bump", "--result", result], dir, {
      http: recordedHttp(),
      run: () => ({ status: 0, output: "" }),
      self: ["uplink-tools"],
    });
    expect(code).toBe(3);
    const written = JSON.parse(readFileSync(result, "utf8"));
    expect(written).toMatchObject({
      schema: "uplink-bump/1",
      verdict: "unverified",
    });
  });

  it("exits 2 when the bump cannot be applied", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const dir = uplinkOn(uplink("4.7.0.0"));
    const code = await deps(["bump", "Nothing"], dir, { http: recordedHttp() });
    expect(code).toBe(2);
  });

  it("pin-ckan writes the spelling CKAN lists the pin under", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const dir = uplinkOn(uplink("4.8.0.0"));
    expect(await deps(["pin-ckan"], dir, { http: recordedHttp() })).toBe(0);
    expect(
      JSON.parse(readFileSync(join(dir, "uplink.json"), "utf8")).mod
        .ckanVersion,
    ).toBe("v4.8.0.0");
  });

  it("refuses a flag it does not read", async () => {
    await expect(deps(["--nope"], uplinkOn(uplink("4.8.1.0")))).rejects.toThrow(
      "not an option",
    );
  });
});
