import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type HostCompat, uplinkDevNotices } from "./devNotice";

const HOST: HostCompat = {
  apiVersion: "3.0.0",
  uiKitVersion: "2.4.0",
  contractMajor: 17,
  contractMinor: 0,
};

function entry(overrides: Record<string, unknown> = {}) {
  return {
    id: "kos",
    versions: [
      {
        apiVersion: HOST.apiVersion,
        uiKitVersion: HOST.uiKitVersion,
        contractMajor: HOST.contractMajor,
        contractMinor: HOST.contractMinor,
        ...overrides,
      },
    ],
  };
}

let dir: string;
let registry: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "uplink-dev-notice-"));
  registry = join(dir, "registry.local.json");
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function write(index: unknown): void {
  writeFileSync(registry, JSON.stringify(index));
}

describe("what the dev server says about Uplinks", () => {
  /**
   * The state a fresh checkout is in. Reported through the loader it is a JSON
   * syntax error, because the dev server answers a path it does not have with
   * the app shell at HTTP 200, so the operator is told about a `<` where the
   * fact is that nothing built the bundles.
   */
  it("says the bundles were never built, and how to get them", () => {
    const [notice] = uplinkDevNotices(registry, HOST);
    expect(notice.level).toBe("warn");
    expect(notice.message).toContain("does not build any");
    expect(notice.message).toContain("vite preview");
  });

  /**
   * The state a tree that HAS been built falls into, and the misreport that
   * cost the most: the loader compares the baked contract against the live one
   * and quarantines each Uplink with a MISMATCH, which reads as ten broken
   * Uplinks rather than one out-of-date artifact.
   */
  it("blames the stale artifact rather than the Uplinks", () => {
    write({
      generatedAt: "2026-09-01T00:00:00.000Z",
      uplinks: [entry({ contractMajor: 15 }), entry({ contractMajor: 15 })],
    });
    const [notice] = uplinkDevNotices(registry, HOST);
    expect(notice.level).toBe("warn");
    expect(notice.message).toContain("older build");
    expect(notice.message).toContain("not about the Uplink");
    expect(notice.message).toContain("contract 15.0, this tree is 17.0");
    expect(notice.message).toContain("2026-09-01");
  });

  it("names the drifting gate, not just the contract", () => {
    write({ uplinks: [entry({ uiKitVersion: "1.0.0" })] });
    const [notice] = uplinkDevNotices(registry, HOST);
    expect(notice.message).toContain("ui-kit 1.0.0, this tree is 2.4.0");
  });

  /**
   * A current index is still not a loadable one: the import map is baked by a
   * build-only plugin too, so a bundle fetched here cannot resolve its bare
   * specifiers. Silence would read as "this works".
   */
  it("still says a widget will not load when the index is current", () => {
    write({ generatedAt: "2026-09-16T00:00:00.000Z", uplinks: [entry()] });
    const [notice] = uplinkDevNotices(registry, HOST);
    expect(notice.level).toBe("info");
    expect(notice.message).toContain("1 Uplink bundle(s)");
    expect(notice.message).toContain("import map");
  });

  it("reports an unreadable index as one, rather than throwing", () => {
    writeFileSync(registry, "{ not json");
    const [notice] = uplinkDevNotices(registry, HOST);
    expect(notice.level).toBe("warn");
    expect(notice.message).toContain("could not be read");
  });
});
