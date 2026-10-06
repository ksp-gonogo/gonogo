// @vitest-environment node
import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  checkNetkan,
  checkZip,
  main,
  selfTest,
} from "../../../scripts/check-ckan-zip.mjs";
import { avcVersion } from "../../../scripts/write-avc-version.mjs";

/**
 * What CKAN reads out of a mod zip and its netkan. A zip CKAN cannot read
 * installs nothing, so each fault is planted in a real zip and the check has
 * to name it; a checker that misses a fault reports a clean zip.
 */

const ROOT = join(__dirname, "../../..");
const FIXTURES = join(ROOT, "scripts/__fixtures__");
const NETKAN_SCHEMA = join(FIXTURES, "NetKAN.schema");
const CKAN_SCHEMA = join(FIXTURES, "CKAN.schema");
const CORE_NETKAN = join(ROOT, "mod/Gonogo.KSP/GonogoCore.netkan");
const BUILD = readFileSync(
  join(ROOT, ".github/workflows/_build-uplink-mod.yml"),
  "utf8",
);

let work: string;
beforeEach(() => {
  work = mkdtempSync(join(tmpdir(), "check-ckan-zip-test-"));
});
afterEach(() => {
  rmSync(work, { recursive: true, force: true });
});

/** The files a real core zip carries, as the build workflow assembles them. */
const realFiles = (): Record<string, string | null> => ({
  "GameData/Gonogo/LICENSE": readFileSync(join(ROOT, "LICENSE"), "utf8"),
  "GameData/Gonogo/Gonogo.version": JSON.stringify(
    avcVersion("Gonogo", "v0.2.0"),
  ),
  "GameData/Gonogo/Plugins/Gonogo.dll": "binary",
  "GameData/Gonogo/Plugins/Sitrep.Host.dll": "binary",
  "GameData/Gonogo/Plugins/Sitrep.Core.dll": "binary",
  "GameData/Gonogo/Plugins/build-info.txt": "version=v0.2.0\ngit_sha=abc\n",
});

function zipOf(name: string, files: Record<string, string | null>) {
  const dir = join(work, name);
  for (const [path, content] of Object.entries(files)) {
    if (content === null) continue;
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), content);
  }
  const zip = join(work, `${name}.zip`);
  execFileSync("zip", ["-qr", zip, "."], { cwd: dir });
  return zip;
}

const check = (name: string, change: Record<string, string | null> = {}) =>
  checkZip({
    zip: zipOf(name, { ...realFiles(), ...change }),
    folder: "Gonogo",
  });

describe("checkZip on the files a real core zip carries", () => {
  it("passes, with Sitrep only in the dll names", () => {
    expect(check("real")).toEqual([]);
  });

  it("reads the .version the write script produces, with an rc label too", () => {
    expect(
      check("rc", {
        "GameData/Gonogo/Gonogo.version": JSON.stringify(
          avcVersion("Gonogo", "rc-abc1234"),
        ),
      }),
    ).toEqual([]);
  });
});

describe("checkZip on each planted fault", () => {
  it("rejects a string KSP_VERSION, the form the writer used to emit", () => {
    const old = { ...avcVersion("Gonogo", "v0.2.0"), KSP_VERSION: "1.12.3" };
    expect(
      check("string-version", {
        "GameData/Gonogo/Gonogo.version": JSON.stringify(old),
      }).join("\n"),
    ).toMatch(/KSP_VERSION must be an object/);
  });

  it("rejects a .version that is not JSON", () => {
    expect(
      check("not-json", {
        "GameData/Gonogo/Gonogo.version": "NAME=Gonogo",
      }).join("\n"),
    ).toMatch(/not valid JSON/);
  });

  it("rejects a second .version and a missing one", () => {
    expect(
      check("two", {
        "GameData/Gonogo/Plugins/Other.version": "{}",
      }).join("\n"),
    ).toMatch(/exactly one \.version file is needed, found 2/);
    expect(
      check("none", { "GameData/Gonogo/Gonogo.version": null }).join("\n"),
    ).toMatch(/found 0/);
  });

  it("rejects a zip with no LICENSE", () => {
    expect(
      check("no-licence", { "GameData/Gonogo/LICENSE": null }).join("\n"),
    ).toMatch(/no LICENSE file inside GameData\/Gonogo\//);
  });

  it("rejects a second root and a root of the wrong name", () => {
    expect(check("beside", { "README.md": "hi" }).join("\n")).toMatch(
      /single root must be GameData\/Gonogo\//,
    );
    expect(check("other", { "GameData/Other/x.cfg": "hi" }).join("\n")).toMatch(
      /single root/,
    );
  });

  it("rejects the codename in a text file and in a file name, never in a Sitrep.*.dll", () => {
    expect(
      check("text", {
        "GameData/Gonogo/Plugins/build-info.txt": "built by Sitrep\n",
      }).join("\n"),
    ).toMatch(/text of GameData\/Gonogo\/Plugins\/build-info\.txt/);
    expect(
      check("name", { "GameData/Gonogo/Sitrep.cfg": "x" }).join("\n"),
    ).toMatch(/file name a player sees/);
    expect(
      check("dll-outside-plugins", {
        "GameData/Gonogo/Sitrep.Extra.dll": "binary",
      }).join("\n"),
    ).toMatch(/file name a player sees/);
  });
});

describe("the netkan", () => {
  const options = {
    netkanSchema: NETKAN_SCHEMA,
    ckanSchema: CKAN_SCHEMA,
  };

  it("GonogoCore.netkan validates against CKAN's NetKAN schema", () => {
    expect(checkNetkan({ netkan: CORE_NETKAN, ...options })).toEqual([]);
  });

  it("rejects a netkan with no identifier, a numeric licence or no download source", () => {
    const doc = JSON.parse(readFileSync(CORE_NETKAN, "utf8"));
    const write = (name: string, changed: object) => {
      const file = join(work, name);
      writeFileSync(file, JSON.stringify(changed));
      return file;
    };
    const { identifier: _identifier, ...noIdentifier } = doc;
    expect(
      checkNetkan({ netkan: write("a.netkan", noIdentifier), ...options }).join(
        "\n",
      ),
    ).toMatch(/identifier/);
    expect(
      checkNetkan({
        netkan: write("b.netkan", { ...doc, license: 7 }),
        ...options,
      }).length,
    ).toBeGreaterThan(0);
    const { $kref: _kref, ...noKref } = doc;
    expect(
      checkNetkan({ netkan: write("c.netkan", noKref), ...options }).length,
    ).toBeGreaterThan(0);
  });
});

describe("the command line", () => {
  const quiet = <T>(run: () => T): T => {
    const log = console.log;
    const error = console.error;
    console.log = () => {};
    console.error = () => {};
    try {
      return run();
    } finally {
      console.log = log;
      console.error = error;
    }
  };

  it("exits 0 on a real zip and its netkan, and 1 on a bad zip", () => {
    const good = zipOf("good", realFiles());
    const bad = zipOf("bad", {
      ...realFiles(),
      "GameData/Gonogo/LICENSE": null,
    });
    const withNetkan = [
      "--netkan",
      CORE_NETKAN,
      "--netkan-schema",
      NETKAN_SCHEMA,
      "--ckan-schema",
      CKAN_SCHEMA,
    ];
    expect(
      quiet(() => main(["--zip", good, "--folder", "Gonogo", ...withNetkan])),
    ).toBe(0);
    expect(quiet(() => main(["--zip", bad, "--folder", "Gonogo"]))).toBe(1);
  });

  it("plants every fault itself and reports a checker that misses one as blind", () => {
    expect(selfTest()).toEqual([]);
    const misses = selfTest(() => []);
    expect(misses.length).toBeGreaterThanOrEqual(9);
    expect(misses.join("\n")).toMatch(/was not reported/);
  });
});

describe("the build workflow", () => {
  it("runs the check on the built zip, before any SpaceDock step", () => {
    const at = BUILD.indexOf("scripts/check-ckan-zip.mjs");
    expect(at).toBeGreaterThan(BUILD.indexOf("- name: Zip GameData"));
    expect(at).toBeLessThan(BUILD.indexOf("id: sd"));
  });

  it("fetches CKAN's own schemas and passes the netkan the matrix names", () => {
    expect(BUILD).toMatch(/KSP-CKAN\/CKAN\/master/);
    expect(BUILD).toMatch(/NetKAN\.schema/);
    const matrix = readFileSync(
      join(ROOT, ".github/workflows/publish-mods.yml"),
      "utf8",
    );
    expect(matrix).toMatch(/netkan: mod\/Gonogo\.KSP\/GonogoCore\.netkan/);
    expect(matrix).toMatch(/netkan: \$\{\{ matrix\.netkan \}\}/);
  });
});
