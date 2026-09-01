import { describe, expect, it } from "vitest";
import {
  hasIdentityToShow,
  hasSelfDeclaredField,
  identityProvenance,
  registryIdentity,
  resolveUplinkIdentity,
} from "./identity";

describe("resolveUplinkIdentity", () => {
  it("takes every field from the roster when the mod declares them", () => {
    const identity = resolveUplinkIdentity(
      "widget-y",
      {
        name: "Widget Y",
        author: "A Stranger",
        repo: "https://example.invalid/stranger/widget-y",
      },
      { name: "Something Else", author: "Someone Else", repo: "elsewhere" },
    );

    expect(identity).toEqual({
      name: { value: "Widget Y", source: "mod" },
      author: { value: "A Stranger", source: "mod" },
      repo: {
        value: "https://example.invalid/stranger/widget-y",
        source: "mod",
      },
    });
  });

  /*
   * The whole of the change: a bundle that declares an author now has that
   * author shown, marked as its own claim, where the app used to substitute
   * "unknown" and throw the declaration away.
   */
  it("falls back to the bundle's own manifest where the mod said nothing", () => {
    const identity = resolveUplinkIdentity(
      "widget-y",
      {},
      {
        name: "Widget Y",
        author: "A Stranger",
        repo: "https://example.invalid/stranger/widget-y",
      },
    );

    expect(identity.name).toEqual({ value: "Widget Y", source: "bundle" });
    expect(identity.author).toEqual({ value: "A Stranger", source: "bundle" });
    expect(identity.repo?.source).toBe("bundle");
  });

  it("keeps per-field provenance when the two sources each fill part of it", () => {
    const identity = resolveUplinkIdentity(
      "widget-y",
      { name: "Widget Y", author: "A Stranger" },
      { repo: "https://example.invalid/stranger/widget-y" },
    );

    expect(identity.name.source).toBe("mod");
    expect(identity.author?.source).toBe("mod");
    expect(identity.repo?.source).toBe("bundle");
  });

  it("treats a blank declaration the same as an absent one", () => {
    const identity = resolveUplinkIdentity(
      "widget-y",
      { name: "", author: "   ", repo: null },
      {},
    );

    expect(identity.name).toEqual({ value: "widget-y", source: "mod" });
    expect(identity.author).toBeUndefined();
    expect(identity.repo).toBeUndefined();
  });

  it("names an Uplink by its mod-reported id when neither source names it", () => {
    const identity = resolveUplinkIdentity("widget-y", {}, {});
    expect(identity.name).toEqual({ value: "widget-y", source: "mod" });
    expect(hasIdentityToShow(identity)).toBe(false);
  });
});

describe("registryIdentity", () => {
  it("marks every field as Hub-listed, since an index is not the bundle", () => {
    const identity = registryIdentity({
      id: "widget-y",
      name: "Widget Y",
      author: "A Stranger",
      repo: "https://example.invalid/stranger/widget-y",
    });

    expect(identity.name.source).toBe("index");
    expect(identity.author?.source).toBe("index");
    expect(hasSelfDeclaredField(identity)).toBe(false);
  });

  it("drops an index entry's empty author rather than showing a blank one", () => {
    const identity = registryIdentity({
      id: "widget-y",
      name: "Widget Y",
      author: "",
      repo: "",
    });

    expect(identity.author).toBeUndefined();
    expect(identity.repo).toBeUndefined();
  });
});

/*
 * The distinction is the deliverable, so these assert the exact words. A
 * mod-vouched identity and a self-declared one must never read the same, and
 * neither may be phrased so a reader takes the second for a checked fact.
 */
describe("identityProvenance", () => {
  it("says the mod vouched for a roster-sourced identity", () => {
    const identity = resolveUplinkIdentity(
      "widget-y",
      { name: "Widget Y", author: "A Stranger" },
      {},
    );
    expect(identityProvenance(identity)).toBe("Vouched by the installed mod");
  });

  it("says a manifest-sourced identity is the bundle's own, unverified", () => {
    const identity = resolveUplinkIdentity(
      "widget-y",
      {},
      { name: "Widget Y", author: "A Stranger" },
    );
    expect(identityProvenance(identity)).toBe(
      "Self-declared by the bundle, unverified",
    );
  });

  it("says a registry-sourced identity is Hub-listed", () => {
    const identity = registryIdentity({
      id: "widget-y",
      name: "Widget Y",
      author: "A Stranger",
      repo: "",
    });
    expect(identityProvenance(identity)).toBe(
      "Listed in the app's built Uplink index",
    );
  });

  it("enumerates each group when the mod named some fields and the bundle the rest", () => {
    const identity = resolveUplinkIdentity(
      "widget-y",
      { name: "Widget Y", author: "A Stranger" },
      { repo: "https://example.invalid/stranger/widget-y" },
    );
    expect(identityProvenance(identity)).toBe(
      "Name and author vouched by the installed mod; " +
        "repo self-declared by the bundle, unverified",
    );
  });

  it("never says unverified about an identity nothing self-declared", () => {
    const identity = resolveUplinkIdentity(
      "widget-y",
      { name: "Widget Y", author: "A Stranger", repo: "example/widget-y" },
      { name: "Impostor", author: "Impostor" },
    );
    expect(identityProvenance(identity)).not.toContain("unverified");
    expect(identityProvenance(identity)).not.toContain("Impostor");
  });
});

describe("hasIdentityToShow", () => {
  it("is true once anything beyond the id has been declared", () => {
    expect(
      hasIdentityToShow(
        resolveUplinkIdentity("widget-y", { author: "A Stranger" }, {}),
      ),
    ).toBe(true);
    expect(
      hasIdentityToShow(
        resolveUplinkIdentity("widget-y", { repo: "example/y" }, {}),
      ),
    ).toBe(true);
  });

  it("is true for a bundle-declared name, which has nowhere else to be shown", () => {
    expect(
      hasIdentityToShow(
        resolveUplinkIdentity("widget-y", {}, { name: "Widget Y" }),
      ),
    ).toBe(true);
  });

  it("is false for a mod-vouched name alone, already carried by the heading", () => {
    expect(
      hasIdentityToShow(
        resolveUplinkIdentity("widget-y", { name: "Widget Y" }, {}),
      ),
    ).toBe(false);
  });
});
