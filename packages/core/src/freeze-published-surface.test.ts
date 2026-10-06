// @vitest-environment node
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  main,
  movesMajor,
  nextVersion,
  planFreeze,
  replaceExtensionApiVersion,
  replaceManifestVersion,
} from "../../../scripts/freeze-published-surface.mjs";

/**
 * The release flow freezes both published surface ledgers and sets the versions
 * the freeze prints. What holds here is the version arithmetic, that an empty
 * note stops the release before anything is written, and that a dry run writes
 * nothing.
 */

const ledgerText = (
  versioning: string,
  version: string,
  pending: { breaks: object[]; additions: object[] },
) =>
  JSON.stringify({
    typescript: "5.9.3",
    versioning,
    versionMoves: "at-release",
    entries: [{ version, note: "n", breaks: [], additions: [], floor: [] }],
    pending,
  });

const change = (key: string, note: string) => ({ key, note });

describe("nextVersion", () => {
  it("moves semver by break or addition", () => {
    expect(nextVersion("6.0.0", true, "semver")).toBe("7.0.0");
    expect(nextVersion("6.2.1", false, "semver")).toBe("6.3.0");
  });

  it("moves a zero-major package by minor for a break, patch for an addition", () => {
    expect(nextVersion("0.1.4", true, "zero-major")).toBe("0.2.0");
    expect(nextVersion("0.1.4", false, "zero-major")).toBe("0.1.5");
  });

  it("reads only a plain version", () => {
    expect(() => nextVersion("6.0", false, "semver")).toThrow(/not a version/);
  });
});

describe("planFreeze", () => {
  it("names the keys, the empty notes and the version it lands on", () => {
    const plan = planFreeze(
      ledgerText("semver", "6.0.0", {
        breaks: [change("a", "why")],
        additions: [change("b", "  ")],
      }),
      "6.0.0",
    );
    expect(plan).toMatchObject({
      pending: true,
      breaks: ["a"],
      additions: ["b"],
      emptyNotes: ["b"],
      next: "7.0.0",
    });
  });

  it("plans nothing when nothing is pending", () => {
    const plan = planFreeze(
      ledgerText("semver", "6.0.0", { breaks: [], additions: [] }),
      "6.0.0",
    );
    expect(plan).toMatchObject({ pending: false, next: null });
  });
});

describe("movesMajor", () => {
  it("is true only across a major", () => {
    expect(movesMajor("6.0.0", "7.0.0")).toBe(true);
    expect(movesMajor("6.0.0", "6.1.0")).toBe(false);
  });
});

describe("the version writers", () => {
  it("replace the one EXTENSION_API_VERSION line", () => {
    const source =
      'a\nexport const EXTENSION_API_VERSION = "6.0.0";\nexport const B = "1.0.0";\n';
    expect(replaceExtensionApiVersion(source, "7.0.0")).toBe(
      'a\nexport const EXTENSION_API_VERSION = "7.0.0";\nexport const B = "1.0.0";\n',
    );
    expect(() => replaceExtensionApiVersion("nothing", "7.0.0")).toThrow(
      /no EXTENSION_API_VERSION/,
    );
  });

  it("replace a manifest's version and keep its other fields", () => {
    const out = replaceManifestVersion(
      '{"name":"x","version":"0.1.0"}',
      "0.2.0",
    );
    expect(JSON.parse(out)).toEqual({ name: "x", version: "0.2.0" });
    expect(out.endsWith("\n")).toBe(true);
  });
});

describe("main", () => {
  let root: string;

  const put = (file: string, text: string) => {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    writeFileSync(join(root, file), text);
  };
  const seed = (extension: string, tools: string) => {
    put("mod/sitrep-sdk/extension-api.ledger.json", extension);
    put("packages/uplink-tools/api-surface.ledger.json", tools);
    put(
      "mod/sitrep-sdk/src/compat-versions.ts",
      'export const EXTENSION_API_VERSION = "6.0.0";\n',
    );
    put("packages/uplink-tools/package.json", '{"version":"0.1.0"}\n');
  };
  const snapshot = () =>
    [
      "mod/sitrep-sdk/extension-api.ledger.json",
      "packages/uplink-tools/api-surface.ledger.json",
      "mod/sitrep-sdk/src/compat-versions.ts",
      "packages/uplink-tools/package.json",
    ].map((file) => readFileSync(join(root, file), "utf8"));

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "freeze-"));
    vi.spyOn(console, "info").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
    rmSync(root, { recursive: true, force: true });
  });

  it("refuses a pending entry with an empty note, naming the ledger and key", () => {
    seed(
      ledgerText("semver", "6.0.0", {
        breaks: [],
        additions: [change("sdk . X", "")],
      }),
      ledgerText("zero-major", "0.1.0", { breaks: [], additions: [] }),
    );
    const before = snapshot();
    expect(() => main(["--note", "r"], root)).toThrow(
      /extension-api: sdk \. X/,
    );
    expect(snapshot()).toEqual(before);
  });

  it("refuses without a note for the entry", () => {
    seed(
      ledgerText("semver", "6.0.0", { breaks: [], additions: [] }),
      ledgerText("zero-major", "0.1.0", { breaks: [], additions: [] }),
    );
    expect(() => main([], root)).toThrow(/--note/);
  });

  it("refuses when the code carries a version the ledger has not frozen", () => {
    seed(
      ledgerText("semver", "5.0.0", { breaks: [], additions: [] }),
      ledgerText("zero-major", "0.1.0", { breaks: [], additions: [] }),
    );
    expect(() => main(["--note", "r", "--dry-run"], root)).toThrow(
      /latest entry is 5\.0\.0/,
    );
  });

  it("a dry run reports what would be frozen and writes nothing", () => {
    seed(
      ledgerText("semver", "6.0.0", {
        breaks: [change("sdk . Y", "gone")],
        additions: [],
      }),
      ledgerText("zero-major", "0.1.0", {
        breaks: [],
        additions: [change("uplink-tools . Z", "new")],
      }),
    );
    const before = snapshot();
    expect(main(["--note", "r", "--dry-run"], root)).toEqual([]);
    expect(snapshot()).toEqual(before);
    const printed = vi
      .mocked(console.info)
      .mock.calls.map((call) => String(call[0]))
      .join("\n");
    expect(printed).toContain("extension-api: 6.0.0 -> 7.0.0");
    expect(printed).toContain("uplink-tools: 0.1.0 -> 0.1.1");
    expect(vi.mocked(console.warn).mock.calls.join("\n")).toContain("re-pins");
  });

  it("does nothing, and says so, when neither ledger has anything pending", () => {
    seed(
      ledgerText("semver", "6.0.0", { breaks: [], additions: [] }),
      ledgerText("zero-major", "0.1.0", { breaks: [], additions: [] }),
    );
    expect(main(["--note", "r"], root)).toEqual([]);
  });
});
