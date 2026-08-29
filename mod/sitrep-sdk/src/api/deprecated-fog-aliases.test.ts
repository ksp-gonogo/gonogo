import { describe, expect, it } from "vitest";
import * as barrel from "./index";

/**
 * A coverage-contributing Uplink is built in a separate repository against the
 * published sdk, and calls `registerFogRevealSource` and `useFogMaskCache` by
 * their pre-rename names. Those are aliases of the coverage names now, and this
 * asserts they are still reachable from the root barrel and still point at the
 * same objects, which an alias block silently dropping one would not.
 *
 * Delete this file with the `as Fog...` aliases in `./index.ts`.
 */
const ALIASED: ReadonlyArray<[keyof typeof barrel, keyof typeof barrel]> = [
  ["FogMaskCache", "CoverageMaskCache"],
  ["FogMaskCacheProvider", "CoverageMaskCacheProvider"],
  ["FogMaskStore", "CoverageMaskStore"],
  ["FogMaskStoreProvider", "CoverageMaskStoreProvider"],
  ["clearFogRevealSources", "clearCoverageSources"],
  ["getFogRevealSourceSettings", "getCoverageSourceSettings"],
  ["getFogRevealSources", "getCoverageSources"],
  ["onFogRevealSourcesChange", "onCoverageSourcesChange"],
  ["registerFogRevealSource", "registerCoverageSource"],
  ["unregisterFogRevealSource", "unregisterCoverageSource"],
  ["useBodyFogMask", "useBodyCoverageMask"],
  ["useFogMaskCache", "useCoverageMaskCache"],
  ["useFogMaskStore", "useCoverageMaskStore"],
];

describe("deprecated fog aliases", () => {
  it.each(ALIASED)("%s is still the same export as %s", (oldName, newName) => {
    expect(barrel[oldName]).toBeDefined();
    expect(barrel[oldName]).toBe(barrel[newName]);
  });
});
