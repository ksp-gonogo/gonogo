// @vitest-environment node
//
// Node realm: this reads C# and TypeScript sources off disk and compares strings.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Every client-side `pluginVersion` fixture must carry the build the Principia
 * Uplink's read gate is pinned to, because that is the only string the field can
 * ever hold.
 *
 * `PrincipiaSession.TryBind` refuses outright unless Principia's own `GetVersion`
 * returns a string ordinally equal to `AnalysedPluginVersion`, and only then
 * stamps `Session.Version`. That value is what `CaptureSettingsOnMain` puts on
 * `SettingsObservation.PluginVersion`, which `SettingsBuilder` writes to the wire
 * as `pluginVersion`. So the field is not "usually" the constant, it is the
 * constant or there is no session at all, and a fixture holding anything else
 * depicts a payload the mod cannot produce.
 *
 * Both halves had drifted when this was written, in two directions at once. The
 * three fixtures below pinned `2026080123-Grassmann`, a 1 August build, while all
 * three of the mod's pins had moved to `2026081218-Levi-Civita`, a 12 August one.
 * They also carried a `"principia "` prefix that appears nowhere in the mod, so
 * the fixed part of the string was wrong as well as the build. Nothing compared
 * them, and a pin that nothing compares to anything is decoration.
 *
 * It lives in core because core is where this repo keeps its cross-package
 * ratchets, and because the C# file is reachable from neither the Uplink client
 * nor the app script being checked. The relation BETWEEN the mod's own three pins
 * is a separate question with a better tool available to it, and is asserted in
 * C# where the types can be named: `GonogoPrincipiaUplink.Tests/PrincipiaVersionPinTests.cs`.
 *
 * Deliberately NOT covered: `analysedVersion` and `detectedVersion` on the write
 * surface. Those are compared to EACH OTHER by the widgets, and the suites drive
 * them with abstract sentinels (`"analysed"` against `"something-else"`) whose
 * only property is matching or not. `detectedVersion` in particular is whatever
 * was found on the player's install, so a fixture depicting a refused write needs
 * it to differ. Pinning either would break the scenarios rather than protect them.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, "..", "..", "..");

const SESSION_CS = join(
  REPO_ROOT,
  "mod",
  "GonogoPrincipiaUplink",
  "PrincipiaSession.cs",
);

/**
 * Where a `pluginVersion` literal may legitimately appear. Roots rather than a
 * file list, so a NEW fixture is covered the day it is added instead of the day
 * somebody remembers this file exists.
 */
const SCAN_ROOTS = [
  join(REPO_ROOT, "mod", "GonogoPrincipiaUplink", "client", "src"),
  join(REPO_ROOT, "packages", "app", "scripts"),
];

/**
 * Generated mirrors of the contract declare `pluginVersion: "text"`, naming the
 * field's UNIT, not its value. They match the literal scan exactly and would
 * report as drift forever, so they are excluded by path. Excluded rather than
 * filtered on what the value looks like: a rule that skipped anything not
 * resembling a version would also skip the stale value this test exists to catch.
 */
const EXCLUDED_DIR = "__generated__";

function readAnalysedPluginVersion(): string {
  if (!existsSync(SESSION_CS)) {
    throw new Error(
      `principia-plugin-version-parity: ${relative(REPO_ROOT, SESSION_CS)} does not exist. ` +
        "The file was renamed or moved; point this test at it rather than " +
        "deleting the check, or the client fixtures go back to being unchecked.",
    );
  }
  const src = readFileSync(SESSION_CS, "utf8");
  const match =
    /public\s+const\s+string\s+AnalysedPluginVersion\s*=\s*"([^"]+)"\s*;/.exec(
      src,
    );
  if (!match) {
    throw new Error(
      `principia-plugin-version-parity: no "public const string AnalysedPluginVersion" ` +
        `in ${relative(REPO_ROOT, SESSION_CS)}. The declaration was renamed or ` +
        "reshaped; point this test at it rather than deleting the check.",
    );
  }
  return match[1];
}

function sourceFilesUnder(root: string): string[] {
  if (!existsSync(root)) {
    throw new Error(
      `principia-plugin-version-parity: scan root ${relative(REPO_ROOT, root)} does not ` +
        "exist. A root that has moved makes this check silently match nothing, " +
        "so it fails here instead.",
    );
  }
  const found: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      if (entry === EXCLUDED_DIR || entry === "node_modules") continue;
      const path = join(dir, entry);
      if (statSync(path).isDirectory()) {
        walk(path);
      } else if (/\.(ts|tsx|json)$/.test(entry)) {
        found.push(path);
      }
    }
  };
  walk(root);
  return found;
}

/** Every `pluginVersion` string literal in the tree, with where it was found. */
function pluginVersionSites(): { path: string; value: string }[] {
  const sites: { path: string; value: string }[] = [];
  for (const root of SCAN_ROOTS) {
    for (const path of sourceFilesUnder(root)) {
      const src = readFileSync(path, "utf8");
      for (const m of src.matchAll(/"?pluginVersion"?\s*:\s*"([^"]*)"/g)) {
        sites.push({ path: relative(REPO_ROOT, path), value: m[1] });
      }
    }
  }
  return sites;
}

describe("Principia client fixtures pin the build the mod is gated to", () => {
  it("finds the read gate's constant in the mod source", () => {
    expect(readAnalysedPluginVersion()).not.toBe("");
  });

  it("finds fixtures to check at all", () => {
    /**
     * The blindness guard, and the reason it is its own case. This check is a
     * text scan over a tree it does not own: a fixture file renamed, a root
     * moved, or the field spelled differently would leave the scan matching
     * nothing and reporting green, which is the failure mode that let the drift
     * this test was written for survive in the first place. Zero sites is
     * therefore a failure, not a clean tree.
     */
    expect(pluginVersionSites().length).toBeGreaterThan(0);
  });

  it("every pluginVersion fixture carries AnalysedPluginVersion verbatim", () => {
    const expected = readAnalysedPluginVersion();
    const stale = pluginVersionSites()
      .filter((s) => s.value !== expected)
      .map((s) => `${s.path}: ${s.value}`);

    expect(
      stale,
      "These fixtures depict a `principia.settings` payload the mod cannot " +
        "produce. `PrincipiaSession.TryBind` refuses any build whose GetVersion " +
        "is not ordinally equal to AnalysedPluginVersion, and a bound session " +
        "stamps that same string onto the wire's `pluginVersion`, so the only " +
        `value this field can hold is "${expected}". If the mod's pin has moved, ` +
        "move these with it; if a fixture means to depict an unbound session, " +
        "the field is absent rather than holding another build.",
    ).toEqual([]);
  });
});
