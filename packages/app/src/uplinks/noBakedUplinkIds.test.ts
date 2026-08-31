// @vitest-environment node
//
// Node realm rather than the package's jsdom default: this test walks the app's
// own source tree and needs no DOM.
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { describe, expect, it } from "vitest";
import { firstPartyUplinkIds } from "../test/firstPartyUplinkIds";

/**
 * The shipped app must not know any Uplink, by id or by package name.
 *
 * The decentralised model is that a third party ships an Uplink this repo has
 * never heard of and it works: the loader learns what to load from the live
 * `system.uplinks` roster, and an explicit `?uplinkLoaderIds=` override is the
 * only other input. Anything inside `src/` that names a specific Uplink
 * contradicts that even when it is only a fallback, because it makes some
 * names load on a path where another author's Uplink never could.
 *
 * The build is a different matter and keeps its list: `uplink-bundle-targets.ts`
 * sits outside `src/` because a build has to name what it builds.
 *
 * ## Two shapes, because one of them slipped through for four days
 *
 * The id check below is the original. It matches a QUOTED BARE ID (`"kos"`),
 * which is the shape a fallback list takes, and it is what `268c16f8a`
 * (2026-08-27) landed when it removed the loader's first-party id list. That
 * commit's message claimed "main.tsx now carries no mod token at all". It was
 * false when written: the same file held eight `import("@ksp-gonogo/gonogo-*-
 * uplink")` calls, and grew to nine. A package SPECIFIER is not a quoted bare
 * id, so this gate reported clean over the larger instance of the thing it
 * exists to ban, and a build-time import is the more privileged shape of the
 * two: a fallback id list at least names something the loader could reach,
 * where a static import is reachable only from inside this build.
 *
 * So the specifier check is the second shape, and it is the one that would have
 * spoken. Both run over the same corpus and both have a planted-violation test,
 * because a checker that cannot be seen to fail reports zero either way.
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

/**
 * Every Uplink client package this source names as an import specifier.
 *
 * Matches the package-name SHAPE rather than the eleven names, and that is
 * deliberate: an Uplink client is `@ksp-gonogo/gonogo-<something>-uplink` by
 * convention, so a gate keyed on the convention catches the twelfth Uplink's
 * import without anyone remembering to extend a list. A list keyed on the
 * current eleven would go quiet for exactly the file that added a new one,
 * which is the only file that matters here.
 *
 * One is a violation, unlike the id check's two: a single static import of an
 * Uplink client is already the whole privilege, whereas a single quoted id is
 * usually a legitimate one-off reference.
 */
function uplinkClientSpecifiers(source: string): string[] {
  return [
    ...new Set(
      [...source.matchAll(/@ksp-gonogo\/gonogo-[a-z0-9-]+-uplink/g)].map(
        (m) => m[0],
      ),
    ),
  ].sort();
}

/**
 * Shipped files that still import an Uplink client package. SHRINK-ONLY: remove
 * a line when the coupling goes, never add one.
 *
 * Seeded 2026-08-31 with exactly one entry, by the specifier check finding it on
 * its first run. It is a DIFFERENT privilege from the nine build-time imports
 * that same change removed, and a larger one, so it is stated rather than
 * absorbed: `StationScreen` wires one named Uplink's brokered (station-mode)
 * WebRTC handshake, reaching it by `getUplinkHandle<TheSource>("<that-id>")`
 * and relaying through `client.sendUplinkRelay("<id>", ...)`. The import is
 * `import type`, so nothing of it survives to the bundle, but the app still
 * knows that one Uplink exists and no other Uplink can ask for the same wiring.
 *
 * Fixing it is not a matter of moving an import. It needs the brokered-transport
 * attach to become something an Uplink DECLARES and the station applies to
 * whatever declared it, which is a design, not a tidy-up. Filed here so the next
 * person finds a named gap rather than a clean gate.
 */
const CLIENT_IMPORT_DEBT: readonly string[] = ["screens/StationScreen.tsx"];

function shippedSourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return shippedSourceFiles(full);
    if (!/\.tsx?$/.test(entry.name)) return [];
    // Tests are not shipped, and several legitimately name an Uplink to build
    // a fixture roster for it.
    if (/\.test\.tsx?$/.test(entry.name)) return [];
    return [full];
  });
}

describe("no baked Uplink ids in shipped app code", () => {
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

  it("finds no Uplink id list under src/", () => {
    const offenders = shippedSourceFiles(SRC_DIR)
      .map((file) => ({
        file: relative(SRC_DIR, file),
        ids: quotedIds(readFileSync(file, "utf8"), TARGET_IDS),
      }))
      .filter(({ ids }) => ids.length >= 2);
    expect(offenders).toEqual([]);
  });
});

describe("no Uplink client package imported by shipped app code", () => {
  /*
   * Both plants use a fictional Uplink, and not out of squeamishness: this file
   * is app-side, so naming a real one here is itself a mod-ownership boundary
   * violation and the boundary gate says so. The check is a regex over the
   * package-name convention, so a fictional name exercises exactly the same
   * code path a real one would.
   */
  it("sees a planted side-effect import", () => {
    const planted = `import "@ksp-gonogo/gonogo-acme-reactor-uplink";`;
    expect(uplinkClientSpecifiers(planted)).toEqual([
      "@ksp-gonogo/gonogo-acme-reactor-uplink",
    ]);
  });

  it("sees a planted dynamic import, which is the shape that slipped through", () => {
    const planted = `await import("@ksp-gonogo/gonogo-acme-turbopump-uplink");`;
    expect(uplinkClientSpecifiers(planted)).toEqual([
      "@ksp-gonogo/gonogo-acme-turbopump-uplink",
    ]);
  });

  it("sees a planted type-only import, which erases at build but still names one", () => {
    const planted = `import type { Src } from "@ksp-gonogo/gonogo-acme-valve-uplink";`;
    expect(uplinkClientSpecifiers(planted)).toEqual([
      "@ksp-gonogo/gonogo-acme-valve-uplink",
    ]);
  });

  it("does not fire on the app's own packages", () => {
    const benign = [
      `import { registerComponent } from "@ksp-gonogo/core";`,
      `import { Panel } from "@ksp-gonogo/ui-kit";`,
      `import { useCommand } from "@ksp-gonogo/sitrep-client";`,
    ].join("\n");
    expect(uplinkClientSpecifiers(benign)).toEqual([]);
  });

  it("finds no Uplink client import under src/ outside the debt list", () => {
    const offenders = shippedSourceFiles(SRC_DIR)
      .map((file) => ({
        file: relative(SRC_DIR, file).split(sep).join("/"),
        specifiers: uplinkClientSpecifiers(readFileSync(file, "utf8")),
      }))
      .filter(({ specifiers }) => specifiers.length > 0)
      .filter(({ file }) => !CLIENT_IMPORT_DEBT.includes(file));
    expect(offenders).toEqual([]);
  });

  /**
   * The staleness direction, so the list can reach zero by attrition rather
   * than outliving its debt and reading as work that is still there.
   */
  it("records no debt entry whose import is already gone", () => {
    const stale = CLIENT_IMPORT_DEBT.filter((file) => {
      const source = readFileSync(resolve(SRC_DIR, file), "utf8");
      return uplinkClientSpecifiers(source).length === 0;
    });
    expect(stale).toEqual([]);
  });
});
