import { describe, expect, it } from "vitest";
import { patchModStrings } from "./json-edit";

const FILE = `{
  "id": "ex1",
  "mod": {
    "name": "Example",
    "tier": "ckan",
    "builtAgainst": "4.7.0.0",
    "channels": [{ "ckan": "Example" }, { "github": "o/r" }],
    "packages": ["a", "b"]
  },
  "ckanDepends": [{ "name": "Harmony2" }]
}
`;

const withMod = (change: Record<string, unknown>, drop: string[] = []) => {
  const value = JSON.parse(FILE);
  Object.assign(value.mod, change);
  for (const key of drop) delete value.mod[key];
  return value;
};

describe("patchModStrings", () => {
  it("adds a property after builtAgainst and keeps every other byte", () => {
    const patched = patchModStrings(
      FILE,
      { ckanVersion: "v4.7.0.0" },
      withMod({ ckanVersion: "v4.7.0.0" }),
    );
    expect(patched).toBe(
      FILE.replace(
        '"builtAgainst": "4.7.0.0",',
        '"builtAgainst": "4.7.0.0",\n    "ckanVersion": "v4.7.0.0",',
      ),
    );
  });

  it("replaces a present value and nothing else", () => {
    const pinned = FILE.replace(
      '"builtAgainst": "4.7.0.0",',
      '"builtAgainst": "4.7.0.0",\n    "ckanVersion": "v4.7.0.0",',
    );
    const patched = patchModStrings(
      pinned,
      { builtAgainst: "4.8.0.0", ckanVersion: "v4.8.0.0" },
      withMod({ builtAgainst: "4.8.0.0", ckanVersion: "v4.8.0.0" }),
    );
    expect(patched).toBe(pinned.replaceAll("4.7.0.0", "4.8.0.0"));
  });

  it("removes a property that is not last", () => {
    const pinned = FILE.replace(
      '"builtAgainst": "4.7.0.0",',
      '"builtAgainst": "4.7.0.0",\n    "ckanVersion": "v4.7.0.0",',
    );
    expect(
      patchModStrings(pinned, { ckanVersion: undefined }, withMod({})),
    ).toBe(FILE);
  });

  it("gives up when the edit would not parse to the expected value", () => {
    expect(
      patchModStrings(
        FILE,
        { ckanVersion: "x" },
        withMod({ ckanVersion: "y" }),
      ),
    ).toBeUndefined();
    expect(patchModStrings("{}", { ckanVersion: "x" }, {})).toBeUndefined();
  });
});
