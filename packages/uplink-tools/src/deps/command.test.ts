import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { deps } from "./command";
import { recordedHttp } from "./recorded";
import { uplinkOn } from "./uplink-on";

const uplink = (builtAgainst: string, ckan = "Example-1") => ({
  id: "ex1",
  mod: {
    name: ckan,
    tier: "ckan",
    ckan,
    builtAgainst,
    channels: [{ ckan }],
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

  it("pin-ckan changes only the ckanVersion line and keeps inline arrays", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const dir = uplinkOn(uplink("4.8.0.0"));
    const file = join(dir, "uplink.json");
    const original = `{\n  "id": "ex1",\n  "mod": {\n    "name": "Example-1",\n    "tier": "ckan",\n    "ckan": "Example-1",\n    "builtAgainst": "4.8.0.0",\n    "channels": [{ "ckan": "Example-1" }, { "github": "o/r" }]\n  },\n  "ckanDepends": [{ "name": "Harmony2" }]\n}\n`;
    writeFileSync(file, original);
    expect(await deps(["pin-ckan"], dir, { http: recordedHttp() })).toBe(0);
    expect(readFileSync(file, "utf8")).toBe(
      original.replace(
        '"builtAgainst": "4.8.0.0",',
        '"builtAgainst": "4.8.0.0",\n    "ckanVersion": "v4.8.0.0",',
      ),
    );
  });

  it("pin-ckan refuses, naming the candidates, when several entries match", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const dir = uplinkOn(uplink("1.0.0", "Dup-1"));
    expect(await deps(["pin-ckan"], dir, { http: recordedHttp() })).toBe(2);
    expect(String(err.mock.calls[0]?.[0])).toContain("1:1.0.0, v1.0.0.0");
    expect(
      JSON.parse(readFileSync(join(dir, "uplink.json"), "utf8")).mod,
    ).not.toHaveProperty("ckanVersion");
  });

  it("pin-ckan refuses, naming CKAN's newest entries, when none matches", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const dir = uplinkOn(uplink("9.9.9"));
    expect(await deps(["pin-ckan"], dir, { http: recordedHttp() })).toBe(2);
    expect(String(err.mock.calls[0]?.[0])).toContain("v4.8.1.0, v4.8.0.0");
  });

  describe("verify-ckan", () => {
    const withPin = (ckanVersion?: string) =>
      uplinkOn({
        id: "ex1",
        mod: {
          ...uplink("4.8.0.0").mod,
          ...(ckanVersion ? { ckanVersion } : {}),
        },
      });

    it("passes when mod.ckanVersion is CKAN's own spelling", async () => {
      vi.spyOn(console, "log").mockImplementation(() => {});
      expect(
        await deps(["verify-ckan"], withPin("v4.8.0.0"), {
          http: recordedHttp(),
        }),
      ).toBe(0);
    });

    it("fails when a CKAN-listed mod has no ckanVersion", async () => {
      const err = vi.spyOn(console, "error").mockImplementation(() => {});
      expect(
        await deps(["verify-ckan"], withPin(), { http: recordedHttp() }),
      ).toBe(1);
      expect(String(err.mock.calls[0]?.[0])).toContain(
        "has no mod.ckanVersion",
      );
    });

    it("fails when ckanVersion is the bare pin and not CKAN's spelling", async () => {
      const err = vi.spyOn(console, "error").mockImplementation(() => {});
      expect(
        await deps(["verify-ckan"], withPin("4.8.0.0"), {
          http: recordedHttp(),
        }),
      ).toBe(1);
      expect(String(err.mock.calls[0]?.[0])).toContain("v4.8.0.0");
    });

    it("exits 2 when CKAN cannot be read", async () => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      expect(
        await deps(["verify-ckan"], withPin("v4.8.0.0"), {
          http: recordedHttp({}),
        }),
      ).toBe(2);
    });
  });

  it("refuses a flag it does not read", async () => {
    await expect(deps(["--nope"], uplinkOn(uplink("4.8.1.0")))).rejects.toThrow(
      "not an option",
    );
  });
});
