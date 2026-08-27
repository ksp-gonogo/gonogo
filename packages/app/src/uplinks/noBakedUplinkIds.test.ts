// @vitest-environment node
//
// Node realm rather than the package's jsdom default: this test walks the app's
// own source tree and needs no DOM.
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { firstPartyUplinkIds } from "../test/firstPartyUplinkIds";

/**
 * The shipped app must not know the names of any first-party Uplink.
 *
 * The decentralised model is that a third party ships an Uplink this repo has
 * never heard of and it works: the loader learns what to load from the live
 * `system.uplinks` roster, and an explicit `?uplinkLoaderIds=` override is the
 * only other input. A list of first-party ids inside `src/` contradicts that
 * even when it is only a fallback, because it makes three names load on a path
 * where a fourth author's Uplink never could.
 *
 * The build is a different matter and keeps its list: `uplink-bundle-targets.ts`
 * sits outside `src/` because a build has to name what it builds.
 */
const SRC_DIR = resolve(import.meta.dirname, "..");
const TARGET_IDS = firstPartyUplinkIds();

/**
 * Which of `ids` this source quotes as a string literal. Two or more in one
 * shipped file is the shape being banned: an array, a Set, an object map and a
 * switch all read the same way here, where a rule about array literals alone
 * would miss three of the four.
 */
function quotedIds(source: string, ids: string[]): string[] {
  return ids.filter((id) => new RegExp(`["'\`]${id}["'\`]`).test(source));
}

function shippedSourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return shippedSourceFiles(full);
    if (!/\.tsx?$/.test(entry.name)) return [];
    // Tests are not shipped, and several legitimately name a first-party
    // Uplink to build a fixture roster for it.
    if (/\.test\.tsx?$/.test(entry.name)) return [];
    return [full];
  });
}

describe("no baked first-party Uplink ids in shipped app code", () => {
  it("has ids to look for, so a pass is not vacuous", () => {
    expect(TARGET_IDS.length).toBeGreaterThanOrEqual(2);
  });

  it("sees a planted violation", () => {
    const planted = `export const IDS = ${JSON.stringify(TARGET_IDS)} as const;`;
    expect(quotedIds(planted, TARGET_IDS)).toEqual(TARGET_IDS);
  });

  it("does not fire on a single id, which is a legitimate one-off reference", () => {
    const benign = `const only = "${TARGET_IDS[0]}";`;
    expect(quotedIds(benign, TARGET_IDS)).toHaveLength(1);
  });

  it("finds no first-party id list under src/", () => {
    const offenders = shippedSourceFiles(SRC_DIR)
      .map((file) => ({
        file: relative(SRC_DIR, file),
        ids: quotedIds(readFileSync(file, "utf8"), TARGET_IDS),
      }))
      .filter(({ ids }) => ids.length >= 2);
    expect(offenders).toEqual([]);
  });
});
