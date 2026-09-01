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

    // Every VALUE is the mod's. The manifest's competing claims ride along as
    // `disputed` rather than being dropped, which is a separate property with
    // its own cases below; what this pins is that they change no value here.
    expect(identity).toEqual({
      name: {
        value: "Widget Y",
        source: "mod",
        disputed: { value: "Something Else", source: "bundle" },
      },
      author: {
        value: "A Stranger",
        source: "mod",
        disputed: { value: "Someone Else", source: "bundle" },
      },
      repo: {
        value: "https://example.invalid/stranger/widget-y",
        source: "mod",
        disputed: { value: "elsewhere", source: "bundle" },
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

/*
 * Two independent claims about the same Uplink: the roster the installed mod
 * reports, and the manifest sidecar the bundle ships. The mod still wins every
 * field, unchanged. What changed is that the losing claim is kept, because
 * "the mod calls this X, the bundle calls itself Y" is exactly the reading an
 * operator needs before consenting to pull the bundle, and the app used to
 * resolve it silently and throw the loser away.
 */
describe("resolveUplinkIdentity: a disagreement between the two sources", () => {
  it("keeps the mod's value and records the bundle's competing one", () => {
    const identity = resolveUplinkIdentity(
      "widget-y",
      { name: "Widget Y", author: "A Stranger" },
      { name: "Impostor", author: "Someone Else" },
    );

    expect(identity.name).toEqual({
      value: "Widget Y",
      source: "mod",
      disputed: { value: "Impostor", source: "bundle" },
    });
    expect(identity.author?.value).toBe("A Stranger");
    expect(identity.author?.disputed).toEqual({
      value: "Someone Else",
      source: "bundle",
    });
  });

  it("records nothing where the two agree", () => {
    const identity = resolveUplinkIdentity(
      "widget-y",
      { name: "Widget Y", author: "A Stranger" },
      { name: "Widget Y", author: "A Stranger" },
    );

    expect(identity.name.disputed).toBeUndefined();
    expect(identity.author?.disputed).toBeUndefined();
  });

  it("records nothing where only one source spoke", () => {
    const fromModOnly = resolveUplinkIdentity(
      "widget-y",
      { author: "A Stranger" },
      {},
    );
    const fromBundleOnly = resolveUplinkIdentity(
      "widget-y",
      {},
      { author: "A Stranger" },
    );

    expect(fromModOnly.author?.disputed).toBeUndefined();
    expect(fromBundleOnly.author?.disputed).toBeUndefined();
  });

  it("treats a blank claim as no claim rather than a disagreement", () => {
    const identity = resolveUplinkIdentity(
      "widget-y",
      { author: "A Stranger" },
      { author: "   " },
    );

    expect(identity.author?.disputed).toBeUndefined();
  });

  /*
   * Compared exactly, on the trimmed values. A repo differing only by a `.git`
   * suffix or an http/https scheme is still two different addresses, and
   * normalising the difference away would be the app deciding which
   * disagreements an operator is not allowed to see.
   */
  it("counts a repo that differs only in scheme as a disagreement", () => {
    const identity = resolveUplinkIdentity(
      "widget-y",
      { repo: "https://example.invalid/stranger/widget-y" },
      { repo: "http://example.invalid/stranger/widget-y" },
    );

    expect(identity.repo?.disputed?.value).toBe(
      "http://example.invalid/stranger/widget-y",
    );
  });

  /*
   * A disagreement is not a refusal and must not read as one: the mod's value
   * is still the value, and the provenance line still says the mod vouched for
   * it. What the loser gets is a line of its own, not a change to who won.
   */
  it("leaves the provenance reading untouched", () => {
    const identity = resolveUplinkIdentity(
      "widget-y",
      { name: "Widget Y", author: "A Stranger" },
      { name: "Impostor", author: "Impostor" },
    );

    expect(identityProvenance(identity)).toBe("Vouched by the installed mod");
    expect(hasSelfDeclaredField(identity)).toBe(false);
  });

  /*
   * A vouched name alone is normally nothing to show, because the caller's own
   * heading already carries it. A vouched name the bundle contradicts is the
   * whole point of the block.
   */
  it("is worth showing even when the disputed field is the name alone", () => {
    expect(
      hasIdentityToShow(
        resolveUplinkIdentity("widget-y", { name: "Widget Y" }, {}),
      ),
    ).toBe(false);
    expect(
      hasIdentityToShow(
        resolveUplinkIdentity(
          "widget-y",
          { name: "Widget Y" },
          { name: "Impostor" },
        ),
      ),
    ).toBe(true);
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
