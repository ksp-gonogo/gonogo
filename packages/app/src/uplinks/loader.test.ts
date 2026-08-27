import type { GonogoUplinkManifest } from "@ksp-gonogo/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { HostCompat } from "./hostCompat";
import {
  descriptorFromClientSource,
  loadEnabledUplinks,
  loadUplinkById,
  manifestUrlFor,
  type RosterEntry,
} from "./loader";
import { __resetUplinkOutcomes, getUplinkOutcomes } from "./loaderState";
import type { RegistryIndex } from "./registry";

/*
 * The bundle argument, for the assertions below that are about WHICH URL was
 * imported rather than about the buffer.
 *
 * `expect.anything()` and not `expect.any(ArrayBuffer)`, which looks stricter and
 * does not work: under jsdom the test realm's `ArrayBuffer` is a different
 * constructor from the one `TextEncoder().encode().buffer` returns, so the
 * instanceof check fails on a value the diff prints as `ArrayBuffer []`.
 *
 * Nothing is lost by relaxing it here. That the executed buffer is the VERIFIED
 * one is a single property with a single owner, asserted by identity in
 * "executes the same buffer it verified".
 */
const IMPORTED_BYTES = expect.anything();

const BUNDLE_BYTES = new TextEncoder().encode(
  "export const marker = 'scansat client bytes';",
).buffer as ArrayBuffer;

async function sha256Of(bytes: ArrayBuffer): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  const hex = Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return `sha256-${hex}`;
}

const HOST: HostCompat = {
  apiVersion: "1.2.0",
  uiKitVersion: "0.3.0",
  contractMajor: 3,
  contractMinor: 5,
};

function indexWith(
  integrity: string,
  overrides: Partial<RegistryIndex["uplinks"][0]["versions"][0]> = {},
): RegistryIndex {
  return {
    uplinks: [
      {
        id: "scansat",
        name: "SCANsat",
        author: "jonpepler",
        repo: "ksp-gonogo/GonogoScansatUplink",
        versions: [
          {
            version: "1.0.0",
            minAppVersion: "1.0.0",
            apiVersion: "1.2.5", // same major.minor as host 1.2.0, patch differs → passes (checkUplinkCompat gates major exactly + client minor <= host minor)
            uiKitVersion: "0.3.9", // host is 0.x (0.3.0) → exact minor match required; both minor 3, patch differs → passes
            contractMajor: 3,
            contractMinor: 3, // <= host's 5 → passes
            bundleUrl: "/uplinks/scansat.client.js",
            integrity,
            expectedClientHash: null,
            ...overrides,
          },
        ],
      },
    ],
  };
}

/** Stub global fetch to serve the given index JSON from the registry URL. */
function stubRegistryFetch(index: RegistryIndex | "fail"): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (String(url).includes("registry.local.json")) {
        if (index === "fail") {
          return { ok: false, status: 503 } as Response;
        }
        return {
          ok: true,
          status: 200,
          json: async () => index,
        } as unknown as Response;
      }
      throw new Error(`unexpected fetch: ${url}`);
    }),
  );
}

let goodHash: string;

beforeEach(async () => {
  __resetUplinkOutcomes();
  goodHash = await sha256Of(BUNDLE_BYTES);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function ctx(extra: {
  index: RegistryIndex | "fail";
  roster?: RosterEntry[];
  importBundle: (bytes: ArrayBuffer, url: string) => Promise<unknown>;
  ensureConsent?: (info: { id: string }) => Promise<boolean>;
  fetchBytes?: (url: string, expectedHash?: string) => Promise<ArrayBuffer>;
}) {
  stubRegistryFetch(extra.index);
  return {
    registrySource: { url: "/uplinks/registry.local.json" },
    // With a roster, the roster drives and no override is wanted. With no
    // roster the loader attempts nothing on its own, so a test that wants a
    // load has to name what it is attempting: that is what the override is.
    override: extra.roster ? undefined : ["scansat"],
    hostCompat: HOST,
    appVersion: "1.0.0",
    roster: extra.roster,
    fetchBytes: extra.fetchBytes ?? (async () => BUNDLE_BYTES),
    importBundle: extra.importBundle,
    // Default to granted so the pre-consent tests exercise the load path; the
    // dedicated consent tests below drive this explicitly.
    ensureConsent: extra.ensureConsent ?? (async () => true),
  };
}

describe("loadEnabledUplinks", () => {
  /*
   * The bytes that are HASHED must be the bytes that are EXECUTED.
   *
   * The loader used to `fetchBytes(url)`, hash that, and then `import(url)`
   * again, so the verified download was thrown away and a second, unverified one
   * was run. Over a same-origin fixture that reads as a caching detail. Over the
   * remote release URL an Uplink declares, a host can serve verified bytes to the
   * first request and anything at all to the second while every arm of the
   * three-way integrity check reports green.
   *
   * This holds the property by IDENTITY rather than by counting fetches: the
   * buffer handed to `importBundle` has to be the very one `fetchBytes` returned.
   * A reintroduced second download cannot satisfy that no matter how it is
   * spelled, which a call-count assertion would not catch (a cached refetch is
   * still one network request and still a different buffer).
   */
  it("executes the same buffer it verified, not a second download", async () => {
    const fetched = BUNDLE_BYTES;
    const importBundle = vi.fn<
      (bytes: ArrayBuffer, url: string) => Promise<unknown>
    >(async () => ({}));

    const outcomes = await loadEnabledUplinks(
      ctx({
        index: indexWith(goodHash),
        importBundle,
        fetchBytes: async () => fetched,
      }),
    );

    expect(outcomes[0].status).toBe("loaded");
    // `toBe`, not `toEqual`: an equal-but-distinct buffer is exactly the bug.
    expect(importBundle.mock.calls[0][0]).toBe(fetched);
  });

  it("loads a verified, compatible Uplink and imports its bundle", async () => {
    const importBundle = vi.fn<
      (bytes: ArrayBuffer, url: string) => Promise<unknown>
    >(async () => ({}));
    const outcomes = await loadEnabledUplinks(
      ctx({ index: indexWith(goodHash), importBundle }),
    );
    expect(outcomes[0].status).toBe("loaded");
    expect(importBundle).toHaveBeenCalledWith(
      IMPORTED_BYTES,
      "/uplinks/scansat.client.js",
    );
    expect(getUplinkOutcomes()[0].status).toBe("loaded");
  });

  it("calls fetchBytes with (bundleUrl, expectedHash): the D6 seam a peer-backed fetchBytes needs", async () => {
    const importBundle = vi.fn<
      (bytes: ArrayBuffer, url: string) => Promise<unknown>
    >(async () => ({}));
    const fetchBytes = vi.fn<
      (url: string, expectedHash?: string) => Promise<ArrayBuffer>
    >(async () => BUNDLE_BYTES);
    const outcomes = await loadEnabledUplinks(
      ctx({ index: indexWith(goodHash), importBundle, fetchBytes }),
    );
    expect(outcomes[0].status).toBe("loaded");
    expect(fetchBytes).toHaveBeenCalledWith(
      "/uplinks/scansat.client.js",
      goodHash,
    );
  });

  it("quarantines on a bundle-hash mismatch and never imports", async () => {
    const importBundle = vi.fn<
      (bytes: ArrayBuffer, url: string) => Promise<unknown>
    >(async () => ({}));
    const outcomes = await loadEnabledUplinks(
      ctx({ index: indexWith("sha256-deadbeef"), importBundle }),
    );
    expect(outcomes[0].status).toBe("quarantined");
    expect(outcomes[0].reason).toMatch(/hash .* != index/);
    expect(importBundle).not.toHaveBeenCalled();
  });

  it("refuses an apiVersion major mismatch BEFORE fetching bytes", async () => {
    const importBundle = vi.fn<
      (bytes: ArrayBuffer, url: string) => Promise<unknown>
    >(async () => ({}));
    const fetchBytes = vi.fn<(url: string) => Promise<ArrayBuffer>>(
      async () => BUNDLE_BYTES,
    );
    stubRegistryFetch(indexWith(goodHash, { apiVersion: "2.0.0" }));
    const outcomes = await loadEnabledUplinks({
      registrySource: { url: "/uplinks/registry.local.json" },
      override: ["scansat"],
      hostCompat: HOST,
      appVersion: "1.0.0",
      ensureConsent: async () => true,
      fetchBytes,
      importBundle,
    });
    expect(outcomes[0].status).toBe("quarantined");
    expect(outcomes[0].reason).toMatch(/apiVersion major mismatch/);
    expect(fetchBytes).not.toHaveBeenCalled();
    expect(importBundle).not.toHaveBeenCalled();
  });

  it("refuses a contractMajor mismatch", async () => {
    const importBundle = vi.fn<
      (bytes: ArrayBuffer, url: string) => Promise<unknown>
    >(async () => ({}));
    const outcomes = await loadEnabledUplinks(
      ctx({ index: indexWith(goodHash, { contractMajor: 2 }), importBundle }),
    );
    expect(outcomes[0].status).toBe("quarantined");
    expect(outcomes[0].reason).toMatch(/contractMajor mismatch/);
  });

  it("refuses a contractMinor that's newer than the host's", async () => {
    const importBundle = vi.fn<
      (bytes: ArrayBuffer, url: string) => Promise<unknown>
    >(async () => ({}));
    const outcomes = await loadEnabledUplinks(
      ctx({ index: indexWith(goodHash, { contractMinor: 6 }), importBundle }),
    );
    expect(outcomes[0].status).toBe("quarantined");
    expect(outcomes[0].reason).toMatch(/contractMinor too new/);
  });

  it("refuses when the live mod reports the Uplink unavailable", async () => {
    const importBundle = vi.fn<
      (bytes: ArrayBuffer, url: string) => Promise<unknown>
    >(async () => ({}));
    const roster: RosterEntry[] = [
      {
        id: "scansat",
        version: "1.0.0",
        available: false,
        reason: "SCANsat not installed",
      },
    ];
    const outcomes = await loadEnabledUplinks(
      ctx({ index: indexWith(goodHash), roster, importBundle }),
    );
    expect(outcomes[0].status).toBe("quarantined");
    expect(outcomes[0].reason).toMatch(/unavailable/);
  });

  it("enforces the three-way check when the mod emits expectedClientHash", async () => {
    const importBundle = vi.fn<
      (bytes: ArrayBuffer, url: string) => Promise<unknown>
    >(async () => ({}));
    const roster: RosterEntry[] = [
      {
        id: "scansat",
        version: "1.0.0",
        available: true,
        reason: null,
        expectedClientHash: "sha256-mismatch",
      },
    ];
    const outcomes = await loadEnabledUplinks(
      ctx({ index: indexWith(goodHash), roster, importBundle }),
    );
    expect(outcomes[0].status).toBe("quarantined");
    expect(outcomes[0].reason).toMatch(/mod expects client/);
    expect(importBundle).not.toHaveBeenCalled();
  });

  it("loads when mod, index, and bytes all agree (three-way pass)", async () => {
    const importBundle = vi.fn<
      (bytes: ArrayBuffer, url: string) => Promise<unknown>
    >(async () => ({}));
    const roster: RosterEntry[] = [
      {
        id: "scansat",
        version: "1.0.0",
        available: true,
        reason: null,
        expectedClientHash: goodHash,
      },
    ];
    const outcomes = await loadEnabledUplinks(
      ctx({ index: indexWith(goodHash), roster, importBundle }),
    );
    expect(outcomes[0].status).toBe("loaded");
    expect(importBundle).toHaveBeenCalledOnce();
  });

  it("quarantines with 'consent declined' and never fetches when consent is refused", async () => {
    const importBundle = vi.fn<
      (bytes: ArrayBuffer, url: string) => Promise<unknown>
    >(async () => ({}));
    const fetchBytes = vi.fn<(url: string) => Promise<ArrayBuffer>>(
      async () => BUNDLE_BYTES,
    );
    const outcomes = await loadEnabledUplinks(
      ctx({
        index: indexWith(goodHash),
        importBundle,
        fetchBytes,
        ensureConsent: async () => false,
      }),
    );
    expect(outcomes[0].status).toBe("quarantined");
    expect(outcomes[0].reason).toMatch(/consent declined/);
    expect(fetchBytes).not.toHaveBeenCalled();
    expect(importBundle).not.toHaveBeenCalled();
  });

  it("loads when consent is granted", async () => {
    const importBundle = vi.fn<
      (bytes: ArrayBuffer, url: string) => Promise<unknown>
    >(async () => ({}));
    const outcomes = await loadEnabledUplinks(
      ctx({
        index: indexWith(goodHash),
        importBundle,
        ensureConsent: async () => true,
      }),
    );
    expect(outcomes[0].status).toBe("loaded");
    expect(importBundle).toHaveBeenCalledOnce();
  });

  it("passes id, name, and version to the consent prompt", async () => {
    const importBundle = vi.fn<
      (bytes: ArrayBuffer, url: string) => Promise<unknown>
    >(async () => ({}));
    const ensureConsent = vi.fn(async () => true);
    await loadEnabledUplinks(
      ctx({ index: indexWith(goodHash), importBundle, ensureConsent }),
    );
    expect(ensureConsent).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "scansat",
        name: "SCANsat",
        version: "1.0.0",
      }),
    );
  });

  it("quarantines every enabled id when the registry is unreadable", async () => {
    const importBundle = vi.fn<
      (bytes: ArrayBuffer, url: string) => Promise<unknown>
    >(async () => ({}));
    const outcomes = await loadEnabledUplinks(
      ctx({ index: "fail", importBundle }),
    );
    expect(outcomes[0].status).toBe("quarantined");
    expect(outcomes[0].reason).toMatch(/registry unavailable/);
    expect(importBundle).not.toHaveBeenCalled();
  });

  it("quarantines an enabled id absent from the index", async () => {
    const importBundle = vi.fn<
      (bytes: ArrayBuffer, url: string) => Promise<unknown>
    >(async () => ({}));
    stubRegistryFetch({ uplinks: [] });
    const outcomes = await loadEnabledUplinks({
      registrySource: { url: "/uplinks/registry.local.json" },
      override: ["scansat"],
      hostCompat: HOST,
      appVersion: "1.0.0",
      ensureConsent: async () => true,
      fetchBytes: async () => BUNDLE_BYTES,
      importBundle,
    });
    expect(outcomes[0].status).toBe("quarantined");
    expect(outcomes[0].reason).toMatch(/not found in the registry index/);
    expect(importBundle).not.toHaveBeenCalled();
  });
});

describe("loadEnabledUplinks: installed-mod-roster drives the enabled set (2026-07-24)", () => {
  it("enables an installed first-party id from the roster alone", async () => {
    const importBundle = vi.fn<
      (bytes: ArrayBuffer, url: string) => Promise<unknown>
    >(async () => ({}));
    stubRegistryFetch(indexWith(goodHash));
    const roster: RosterEntry[] = [
      { id: "scansat", version: "1.0.0", available: true, reason: null },
    ];
    const outcomes = await loadEnabledUplinks({
      registrySource: { url: "/uplinks/registry.local.json" },
      hostCompat: HOST,
      appVersion: "1.0.0",
      roster,
      ensureConsent: async () => true,
      fetchBytes: async () => BUNDLE_BYTES,
      importBundle,
    });
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0].id).toBe("scansat");
    expect(outcomes[0].status).toBe("loaded");
    expect(importBundle).toHaveBeenCalledWith(
      IMPORTED_BYTES,
      "/uplinks/scansat.client.js",
    );
  });

  // Override-precedence: an explicit `?uplinkLoaderIds=` is a deliberate dev/test
  // intent and must WIN over the roster (regression for the Hub-wizard e2e, whose
  // fixture always supplies a roster: the override was silently ignored before).
  it("an explicit override (even empty) wins over the roster, loads nothing", async () => {
    const importBundle = vi.fn<
      (bytes: ArrayBuffer, url: string) => Promise<unknown>
    >(async () => ({}));
    stubRegistryFetch(indexWith(goodHash));
    const roster: RosterEntry[] = [
      { id: "scansat", version: "1.0.0", available: true, reason: null },
    ];
    const outcomes = await loadEnabledUplinks({
      registrySource: { url: "/uplinks/registry.local.json" },
      override: [], // explicit "load nothing": must beat the roster's scansat
      hostCompat: HOST,
      appVersion: "1.0.0",
      roster,
      ensureConsent: async () => true,
      fetchBytes: async () => BUNDLE_BYTES,
      importBundle,
    });
    expect(outcomes).toHaveLength(0);
    expect(importBundle).not.toHaveBeenCalled();
  });

  it("an explicit override loads its ids even when the roster omits them", async () => {
    const importBundle = vi.fn<
      (bytes: ArrayBuffer, url: string) => Promise<unknown>
    >(async () => ({}));
    stubRegistryFetch(indexWith(goodHash));
    const outcomes = await loadEnabledUplinks({
      registrySource: { url: "/uplinks/registry.local.json" },
      override: ["scansat"], // explicit: must win over the roster's "nothing installed"
      hostCompat: HOST,
      appVersion: "1.0.0",
      roster: [], // mod reports nothing installed
      ensureConsent: async () => true,
      fetchBytes: async () => BUNDLE_BYTES,
      importBundle,
    });
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0].id).toBe("scansat");
    expect(outcomes[0].status).toBe("loaded");
  });

  it("loads nothing when the roster reports nothing installed", async () => {
    const importBundle = vi.fn<
      (bytes: ArrayBuffer, url: string) => Promise<unknown>
    >(async () => ({}));
    stubRegistryFetch(indexWith(goodHash));
    const outcomes = await loadEnabledUplinks({
      registrySource: { url: "/uplinks/registry.local.json" },
      hostCompat: HOST,
      appVersion: "1.0.0",
      roster: [], // mod answered: nothing installed
      ensureConsent: async () => true,
      fetchBytes: async () => BUNDLE_BYTES,
      importBundle,
    });
    expect(outcomes).toHaveLength(0);
    expect(importBundle).not.toHaveBeenCalled();
    expect(getUplinkOutcomes()).toHaveLength(0);
  });

  it("does not attempt an installed roster id that has no first-party descriptor in the local registry (installed-no-client, a gap, not an auto-load)", async () => {
    const importBundle = vi.fn<
      (bytes: ArrayBuffer, url: string) => Promise<unknown>
    >(async () => ({}));
    // The local registry only ships "scansat": "widget-y" is a mod the
    // roster reports installed with no published client at all.
    stubRegistryFetch(indexWith(goodHash));
    const roster: RosterEntry[] = [
      { id: "widget-y", version: "1.0.0", available: true, reason: null },
    ];
    const outcomes = await loadEnabledUplinks({
      registrySource: { url: "/uplinks/registry.local.json" },
      hostCompat: HOST,
      appVersion: "1.0.0",
      roster,
      ensureConsent: async () => true,
      fetchBytes: async () => BUNDLE_BYTES,
      importBundle,
    });
    expect(outcomes).toHaveLength(0);
    expect(importBundle).not.toHaveBeenCalled();
    // No outcome recorded at all (never "quarantined: not found in the
    // registry index" either): this id was never enabled in the first
    // place, distinct from an enabled-but-missing-descriptor case. The
    // wizard's `useUplinkGap` (`computeUplinkGap`) is what turns this exact
    // shape (installed, no loaded outcome, hub index has no descriptor for
    // it) into the visible `installed-no-client` gap row; see
    // `useUplinkGap.test.ts`'s "installed-no-client" cases, which exercise
    // the same shared join (`rosterGap.ts`) this derivation calls.
    expect(getUplinkOutcomes()).toHaveLength(0);
  });

  // No shipped fallback list stands behind an absent roster, deliberately: a
  // list would have to name ids, and a first-party name loading on this path is
  // one a fourth author's Uplink could never reach. Nothing has told us what is
  // installed, so nothing is attempted and the roster, or an explicit override,
  // is what says otherwise.
  it("roster ABSENT and no override attempts nothing, no bundle fetched", async () => {
    const importBundle = vi.fn<
      (bytes: ArrayBuffer, url: string) => Promise<unknown>
    >(async () => ({}));
    const fetchBytes = vi.fn<(url: string) => Promise<ArrayBuffer>>(
      async () => BUNDLE_BYTES,
    );
    stubRegistryFetch(indexWith(goodHash));
    const outcomes = await loadEnabledUplinks({
      registrySource: { url: "/uplinks/registry.local.json" },
      hostCompat: HOST,
      appVersion: "1.0.0",
      // No `roster` key at all: the real "no mod talking yet" shape.
      ensureConsent: async () => true,
      fetchBytes,
      importBundle,
    });
    expect(outcomes).toEqual([]);
    expect(getUplinkOutcomes()).toHaveLength(0);
    expect(fetchBytes).not.toHaveBeenCalled();
    expect(importBundle).not.toHaveBeenCalled();
  });

  // A dead registry has to be visible rather than a blank dashboard, so this arm
  // quarantines the ids it WOULD have attempted, drawn from the same two inputs
  // everything else reads: an override outright, otherwise every roster id. A
  // roster-driven boot is the case that would otherwise have gone silent.
  it("quarantines the roster's ids when the registry is unreadable", async () => {
    const importBundle = vi.fn<
      (bytes: ArrayBuffer, url: string) => Promise<unknown>
    >(async () => ({}));
    stubRegistryFetch("fail");
    const outcomes = await loadEnabledUplinks({
      registrySource: { url: "/uplinks/registry.local.json" },
      hostCompat: HOST,
      appVersion: "1.0.0",
      roster: [
        { id: "scansat", version: "1.0.0", available: true, reason: null },
      ],
      ensureConsent: async () => true,
      fetchBytes: async () => BUNDLE_BYTES,
      importBundle,
    });
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0].id).toBe("scansat");
    expect(outcomes[0].status).toBe("quarantined");
    expect(outcomes[0].reason).toMatch(/registry unavailable/);
    expect(importBundle).not.toHaveBeenCalled();
  });

  it("a mod-reported-unavailable installed id is still ENABLED (attempted) so checkCompat's veto can quarantine it with a reason", async () => {
    const importBundle = vi.fn<
      (bytes: ArrayBuffer, url: string) => Promise<unknown>
    >(async () => ({}));
    stubRegistryFetch(indexWith(goodHash));
    const roster: RosterEntry[] = [
      {
        id: "scansat",
        version: "1.0.0",
        available: false,
        reason: "SCANsat not installed",
      },
    ];
    const outcomes = await loadEnabledUplinks({
      registrySource: { url: "/uplinks/registry.local.json" },
      hostCompat: HOST,
      appVersion: "1.0.0",
      roster,
      ensureConsent: async () => true,
      fetchBytes: async () => BUNDLE_BYTES,
      importBundle,
    });
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0].status).toBe("quarantined");
    expect(outcomes[0].reason).toMatch(/unavailable/);
    expect(importBundle).not.toHaveBeenCalled();
  });
});

describe("loadUplinkById", () => {
  it("fetches the registry and loads only the requested id", async () => {
    const importBundle = vi.fn<
      (bytes: ArrayBuffer, url: string) => Promise<unknown>
    >(async () => ({}));
    const outcome = await loadUplinkById(
      "scansat",
      ctx({ index: indexWith(goodHash), importBundle }),
    );
    expect(outcome.status).toBe("loaded");
    expect(outcome.id).toBe("scansat");
    expect(importBundle).toHaveBeenCalledWith(
      IMPORTED_BYTES,
      "/uplinks/scansat.client.js",
    );
    expect(getUplinkOutcomes()[0].status).toBe("loaded");
  });

  it("reuses the ensureConsent/fetchBytes/importBundle DI seam", async () => {
    const importBundle = vi.fn<
      (bytes: ArrayBuffer, url: string) => Promise<unknown>
    >(async () => ({}));
    const ensureConsent = vi.fn(async () => false);
    const outcome = await loadUplinkById(
      "scansat",
      ctx({ index: indexWith(goodHash), importBundle, ensureConsent }),
    );
    expect(ensureConsent).toHaveBeenCalled();
    expect(outcome.status).toBe("quarantined");
    expect(outcome.reason).toMatch(/consent declined/);
    expect(importBundle).not.toHaveBeenCalled();
  });

  it("quarantines when the id isn't in the registry index", async () => {
    const importBundle = vi.fn<
      (bytes: ArrayBuffer, url: string) => Promise<unknown>
    >(async () => ({}));
    stubRegistryFetch(indexWith(goodHash));
    const outcome = await loadUplinkById("kos", {
      registrySource: { url: "/uplinks/registry.local.json" },
      hostCompat: HOST,
      appVersion: "1.0.0",
      ensureConsent: async () => true,
      fetchBytes: async () => BUNDLE_BYTES,
      importBundle,
    });
    expect(outcome.status).toBe("quarantined");
    expect(outcome.reason).toMatch(/not found in the registry index/);
    expect(importBundle).not.toHaveBeenCalled();
  });

  it("quarantines when the registry is unreadable", async () => {
    const importBundle = vi.fn<
      (bytes: ArrayBuffer, url: string) => Promise<unknown>
    >(async () => ({}));
    const outcome = await loadUplinkById(
      "scansat",
      ctx({ index: "fail", importBundle }),
    );
    expect(outcome.status).toBe("quarantined");
    expect(outcome.reason).toMatch(/registry unavailable/);
    expect(importBundle).not.toHaveBeenCalled();
  });

  it("single-picks a third-party id via clientSource when it's absent from the local index (follow-on #5)", async () => {
    const importBundle = vi.fn<
      (bytes: ArrayBuffer, url: string) => Promise<unknown>
    >(async () => ({}));
    stubRegistryFetch(indexWith(goodHash)); // local index only ever ships "scansat"
    const bytes = new TextEncoder().encode("export const marker = 'widget-y';")
      .buffer as ArrayBuffer;
    const thirdPartyHash = await sha256Of(bytes);
    const manifest: GonogoUplinkManifest = {
      id: "widget-y",
      version: "2.0.0",
      minAppVersion: "1.0.0",
      apiVersion: "1.2.5",
      uiKitVersion: "0.3.9",
      contractMajor: 3,
      contractMinor: 3,
      integrity: thirdPartyHash,
    };
    const roster: RosterEntry[] = [
      {
        id: "widget-y",
        version: "2.0.0",
        available: true,
        reason: null,
        expectedClientHash: thirdPartyHash,
        clientSource: {
          url: "https://cdn.example/widget-y.client.js",
          devPath: null,
        },
      },
    ];
    const fetchManifest = vi.fn(async (url: string) => {
      expect(url).toBe("https://cdn.example/gonogo-uplink.json");
      return manifest;
    });
    const outcome = await loadUplinkById("widget-y", {
      registrySource: { url: "/uplinks/registry.local.json" },
      hostCompat: HOST,
      appVersion: "1.0.0",
      roster,
      ensureConsent: async () => true,
      fetchBytes: async () => bytes,
      fetchManifest,
      importBundle,
    });
    expect(outcome.status).toBe("loaded");
    expect(outcome.id).toBe("widget-y");
    expect(fetchManifest).toHaveBeenCalled();
    expect(importBundle).toHaveBeenCalledWith(
      IMPORTED_BYTES,
      "https://cdn.example/widget-y.client.js",
    );
  });

  it("still quarantines an id absent from BOTH the local index and the roster's clientSource (follow-on #5 negative)", async () => {
    const importBundle = vi.fn<
      (bytes: ArrayBuffer, url: string) => Promise<unknown>
    >(async () => ({}));
    stubRegistryFetch(indexWith(goodHash));
    const outcome = await loadUplinkById("widget-z", {
      registrySource: { url: "/uplinks/registry.local.json" },
      hostCompat: HOST,
      appVersion: "1.0.0",
      // roster has widget-z installed but with NO clientSource → not loadable
      roster: [
        {
          id: "widget-z",
          version: "1.0.0",
          available: true,
          reason: null,
          expectedClientHash: null,
          clientSource: null,
        },
      ],
      ensureConsent: async () => true,
      fetchBytes: async () => BUNDLE_BYTES,
      importBundle,
    });
    expect(outcome.status).toBe("quarantined");
    expect(outcome.reason).toMatch(/not found in the registry index/);
    expect(importBundle).not.toHaveBeenCalled();
  });
});

describe("manifestUrlFor", () => {
  it("derives the sidecar URL from the bundle's directory (full origin)", () => {
    expect(
      manifestUrlFor("https://cdn.example/uplinks/widget-y.client.js"),
    ).toBe("https://cdn.example/uplinks/gonogo-uplink.json");
  });

  it("works for a bare path with no origin", () => {
    expect(manifestUrlFor("/uplinks/widget-y.client.js")).toBe(
      "/uplinks/gonogo-uplink.json",
    );
  });

  it("works for a dev-server URL with a port", () => {
    expect(manifestUrlFor("http://localhost:5173/widget-y.client.js")).toBe(
      "http://localhost:5173/gonogo-uplink.json",
    );
  });
});

describe("descriptorFromClientSource", () => {
  const manifest: GonogoUplinkManifest = {
    id: "widget-y",
    version: "2.0.0",
    minAppVersion: "1.0.0",
    apiVersion: "1.2.5",
    uiKitVersion: "0.3.9",
    contractMajor: 3,
    contractMinor: 3,
    integrity: "sha256-manifest-self-declared",
  };

  function rosterEntry(overrides: Partial<RosterEntry> = {}): RosterEntry {
    return {
      id: "widget-y",
      version: "2.0.0",
      available: true,
      reason: null,
      expectedClientHash: "sha256-mod-vouched",
      clientSource: {
        url: "https://cdn.example/widget-y.client.js",
        devPath: null,
      },
      ...overrides,
    };
  }

  it("prefers clientSource.devPath over clientSource.url for bundleUrl", () => {
    const descriptor = descriptorFromClientSource(
      rosterEntry({
        clientSource: {
          url: "https://cdn.example/widget-y.client.js",
          devPath: "http://localhost:5173/widget-y.client.js",
        },
      }),
      manifest,
    );
    expect(descriptor.versions[0].bundleUrl).toBe(
      "http://localhost:5173/widget-y.client.js",
    );
  });

  it("falls back to clientSource.url when devPath is null", () => {
    const descriptor = descriptorFromClientSource(rosterEntry(), manifest);
    expect(descriptor.versions[0].bundleUrl).toBe(
      "https://cdn.example/widget-y.client.js",
    );
  });

  it("uses the roster's expectedClientHash as integrity, NOT the manifest's own integrity", () => {
    const descriptor = descriptorFromClientSource(rosterEntry(), manifest);
    expect(descriptor.versions[0].integrity).toBe("sha256-mod-vouched");
    expect(descriptor.versions[0].integrity).not.toBe(manifest.integrity);
  });

  it("carries the compat fields straight from the manifest", () => {
    const descriptor = descriptorFromClientSource(rosterEntry(), manifest);
    const version = descriptor.versions[0];
    expect(version.version).toBe(manifest.version);
    expect(version.minAppVersion).toBe(manifest.minAppVersion);
    expect(version.apiVersion).toBe(manifest.apiVersion);
    expect(version.uiKitVersion).toBe(manifest.uiKitVersion);
    expect(version.contractMajor).toBe(manifest.contractMajor);
    expect(version.contractMinor).toBe(manifest.contractMinor);
    expect(descriptor.id).toBe("widget-y");
  });

  it("throws when clientSource is missing", () => {
    const { clientSource: _clientSource, ...withoutClientSource } =
      rosterEntry();
    expect(() =>
      descriptorFromClientSource(withoutClientSource, manifest),
    ).toThrow(/clientSource/);
  });

  it("throws when expectedClientHash is missing", () => {
    expect(() =>
      descriptorFromClientSource(
        rosterEntry({ expectedClientHash: null }),
        manifest,
      ),
    ).toThrow(/expectedClientHash/);
  });
});

describe("loadEnabledUplinks: third-party clientSource path (D5-loader follow-on, 2026-07-25)", () => {
  const THIRD_PARTY_BYTES = new TextEncoder().encode(
    "export const marker = 'widget-y client bytes';",
  ).buffer as ArrayBuffer;

  function manifestFor(
    overrides: Partial<GonogoUplinkManifest> = {},
  ): GonogoUplinkManifest {
    return {
      id: "widget-y",
      version: "2.0.0",
      minAppVersion: "1.0.0",
      apiVersion: "1.2.5", // same major.minor as HOST 1.2.0 → passes
      uiKitVersion: "0.3.9", // HOST is 0.x (0.3.0) → same minor (3) → passes
      contractMajor: 3, // == HOST's 3 → passes
      contractMinor: 3, // <= HOST's 5 → passes
      integrity: "sha256-manifest-self-declared",
      ...overrides,
    };
  }

  it("loads a third-party id via clientSource + a fetched manifest, preferring devPath", async () => {
    const importBundle = vi.fn<
      (bytes: ArrayBuffer, url: string) => Promise<unknown>
    >(async () => ({}));
    stubRegistryFetch(indexWith(goodHash)); // local index only ever ships "scansat"
    const thirdPartyHash = await sha256Of(THIRD_PARTY_BYTES);
    const roster: RosterEntry[] = [
      {
        id: "widget-y",
        version: "2.0.0",
        available: true,
        reason: null,
        expectedClientHash: thirdPartyHash,
        clientSource: {
          url: "https://cdn.example/widget-y.client.js",
          devPath: "http://localhost:5173/widget-y.client.js",
        },
      },
    ];
    const fetchManifest = vi.fn(async (url: string) => {
      expect(url).toBe("http://localhost:5173/gonogo-uplink.json");
      return manifestFor({ integrity: thirdPartyHash });
    });
    const fetchBytes = vi.fn(async (url: string) => {
      expect(url).toBe("http://localhost:5173/widget-y.client.js");
      return THIRD_PARTY_BYTES;
    });
    const outcomes = await loadEnabledUplinks({
      registrySource: { url: "/uplinks/registry.local.json" },
      hostCompat: HOST,
      appVersion: "1.0.0",
      roster,
      ensureConsent: async () => true,
      fetchBytes,
      fetchManifest,
      importBundle,
    });
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0].id).toBe("widget-y");
    expect(outcomes[0].status).toBe("loaded");
    expect(importBundle).toHaveBeenCalledWith(
      IMPORTED_BYTES,
      "http://localhost:5173/widget-y.client.js",
    );
  });

  it("uses clientSource.url when devPath is absent", async () => {
    const importBundle = vi.fn<
      (bytes: ArrayBuffer, url: string) => Promise<unknown>
    >(async () => ({}));
    stubRegistryFetch(indexWith(goodHash));
    const thirdPartyHash = await sha256Of(THIRD_PARTY_BYTES);
    const roster: RosterEntry[] = [
      {
        id: "widget-y",
        version: "2.0.0",
        available: true,
        reason: null,
        expectedClientHash: thirdPartyHash,
        clientSource: {
          url: "https://cdn.example/widget-y.client.js",
          devPath: null,
        },
      },
    ];
    const fetchManifest = vi.fn(async (url: string) => {
      expect(url).toBe("https://cdn.example/gonogo-uplink.json");
      return manifestFor({ integrity: thirdPartyHash });
    });
    const outcomes = await loadEnabledUplinks({
      registrySource: { url: "/uplinks/registry.local.json" },
      hostCompat: HOST,
      appVersion: "1.0.0",
      roster,
      ensureConsent: async () => true,
      fetchBytes: async () => THIRD_PARTY_BYTES,
      fetchManifest,
      importBundle,
    });
    expect(outcomes[0].status).toBe("loaded");
    expect(importBundle).toHaveBeenCalledWith(
      IMPORTED_BYTES,
      "https://cdn.example/widget-y.client.js",
    );
  });

  it("refuses hash-blind BEFORE any fetch when the mod hasn't vouched a hash", async () => {
    const importBundle = vi.fn<
      (bytes: ArrayBuffer, url: string) => Promise<unknown>
    >(async () => ({}));
    stubRegistryFetch(indexWith(goodHash));
    const roster: RosterEntry[] = [
      {
        id: "widget-y",
        version: "2.0.0",
        available: true,
        reason: null,
        expectedClientHash: null,
        clientSource: {
          url: "https://cdn.example/widget-y.client.js",
          devPath: null,
        },
      },
    ];
    const fetchManifest = vi.fn(async () => manifestFor());
    const fetchBytes = vi.fn(async () => THIRD_PARTY_BYTES);
    const outcomes = await loadEnabledUplinks({
      registrySource: { url: "/uplinks/registry.local.json" },
      hostCompat: HOST,
      appVersion: "1.0.0",
      roster,
      ensureConsent: async () => true,
      fetchBytes,
      fetchManifest,
      importBundle,
    });
    expect(outcomes[0].status).toBe("quarantined");
    expect(outcomes[0].reason).toMatch(/no mod-vouched client hash/);
    expect(fetchManifest).not.toHaveBeenCalled();
    expect(fetchBytes).not.toHaveBeenCalled();
    expect(importBundle).not.toHaveBeenCalled();
  });

  it("quarantines with a legible reason when the manifest fetch fails", async () => {
    const importBundle = vi.fn<
      (bytes: ArrayBuffer, url: string) => Promise<unknown>
    >(async () => ({}));
    stubRegistryFetch(indexWith(goodHash));
    const roster: RosterEntry[] = [
      {
        id: "widget-y",
        version: "2.0.0",
        available: true,
        reason: null,
        expectedClientHash: "sha256-mod-vouched",
        clientSource: {
          url: "https://cdn.example/widget-y.client.js",
          devPath: null,
        },
      },
    ];
    const outcomes = await loadEnabledUplinks({
      registrySource: { url: "/uplinks/registry.local.json" },
      hostCompat: HOST,
      appVersion: "1.0.0",
      roster,
      ensureConsent: async () => true,
      fetchBytes: async () => THIRD_PARTY_BYTES,
      fetchManifest: async () => {
        throw new Error("network unreachable");
      },
      importBundle,
    });
    expect(outcomes[0].status).toBe("quarantined");
    expect(outcomes[0].reason).toMatch(
      /manifest fetch\/parse failed.*network unreachable/,
    );
    expect(importBundle).not.toHaveBeenCalled();
  });

  it("quarantines with a legible reason when the fetched manifest is malformed", async () => {
    const importBundle = vi.fn<
      (bytes: ArrayBuffer, url: string) => Promise<unknown>
    >(async () => ({}));
    stubRegistryFetch(indexWith(goodHash));
    const roster: RosterEntry[] = [
      {
        id: "widget-y",
        version: "2.0.0",
        available: true,
        reason: null,
        expectedClientHash: "sha256-mod-vouched",
        clientSource: {
          url: "https://cdn.example/widget-y.client.js",
          devPath: null,
        },
      },
    ];
    const outcomes = await loadEnabledUplinks({
      registrySource: { url: "/uplinks/registry.local.json" },
      hostCompat: HOST,
      appVersion: "1.0.0",
      roster,
      ensureConsent: async () => true,
      fetchBytes: async () => THIRD_PARTY_BYTES,
      fetchManifest: async () => ({ id: "widget-y" }), // missing every other field
      importBundle,
    });
    expect(outcomes[0].status).toBe("quarantined");
    expect(outcomes[0].reason).toMatch(/manifest fetch\/parse failed/);
    expect(importBundle).not.toHaveBeenCalled();
  });

  it("quarantines a compat-incompatible third-party manifest BEFORE fetching bundle bytes", async () => {
    const importBundle = vi.fn<
      (bytes: ArrayBuffer, url: string) => Promise<unknown>
    >(async () => ({}));
    stubRegistryFetch(indexWith(goodHash));
    const roster: RosterEntry[] = [
      {
        id: "widget-y",
        version: "2.0.0",
        available: true,
        reason: null,
        expectedClientHash: "sha256-mod-vouched",
        clientSource: {
          url: "https://cdn.example/widget-y.client.js",
          devPath: null,
        },
      },
    ];
    const fetchBytes = vi.fn(async () => THIRD_PARTY_BYTES);
    const outcomes = await loadEnabledUplinks({
      registrySource: { url: "/uplinks/registry.local.json" },
      hostCompat: HOST,
      appVersion: "1.0.0",
      roster,
      ensureConsent: async () => true,
      fetchBytes,
      // integrity matches expectedClientHash so the manifest-integrity gate
      // passes and this test still reaches the compat gate it's asserting.
      fetchManifest: async () =>
        manifestFor({ apiVersion: "2.0.0", integrity: "sha256-mod-vouched" }),
      importBundle,
    });
    expect(outcomes[0].status).toBe("quarantined");
    expect(outcomes[0].reason).toMatch(/apiVersion major mismatch/);
    expect(fetchBytes).not.toHaveBeenCalled();
    expect(importBundle).not.toHaveBeenCalled();
  });

  it("hard-refuses BEFORE fetching bytes when the manifest integrity disagrees with the mod-vouched hash (follow-on #4)", async () => {
    const importBundle = vi.fn<
      (bytes: ArrayBuffer, url: string) => Promise<unknown>
    >(async () => ({}));
    stubRegistryFetch(indexWith(goodHash));
    const roster: RosterEntry[] = [
      {
        id: "widget-y",
        version: "2.0.0",
        available: true,
        reason: null,
        expectedClientHash: "sha256-mod-vouched",
        clientSource: {
          url: "https://cdn.example/widget-y.client.js",
          devPath: null,
        },
      },
    ];
    const fetchBytes = vi.fn(async () => THIRD_PARTY_BYTES);
    const outcomes = await loadEnabledUplinks({
      registrySource: { url: "/uplinks/registry.local.json" },
      hostCompat: HOST,
      appVersion: "1.0.0",
      roster,
      ensureConsent: async () => true,
      fetchBytes,
      // manifest self-declares a DIFFERENT integrity than the mod vouched,
      // a real fault since mod + client release together (operator ruling).
      fetchManifest: async () =>
        manifestFor({ integrity: "sha256-manifest-disagrees" }),
      importBundle,
    });
    expect(outcomes[0].status).toBe("quarantined");
    expect(outcomes[0].reason).toMatch(
      /manifest-declared integrity.*!= mod-vouched/,
    );
    // Refused before ever fetching the bundle bytes or importing.
    expect(fetchBytes).not.toHaveBeenCalled();
    expect(importBundle).not.toHaveBeenCalled();
  });

  it("quarantines on a bundle-hash mismatch and never imports", async () => {
    const importBundle = vi.fn<
      (bytes: ArrayBuffer, url: string) => Promise<unknown>
    >(async () => ({}));
    stubRegistryFetch(indexWith(goodHash));
    const roster: RosterEntry[] = [
      {
        id: "widget-y",
        version: "2.0.0",
        available: true,
        reason: null,
        expectedClientHash: "sha256-mod-vouched-but-wrong",
        clientSource: {
          url: "https://cdn.example/widget-y.client.js",
          devPath: null,
        },
      },
    ];
    const outcomes = await loadEnabledUplinks({
      registrySource: { url: "/uplinks/registry.local.json" },
      hostCompat: HOST,
      appVersion: "1.0.0",
      roster,
      ensureConsent: async () => true,
      fetchBytes: async () => THIRD_PARTY_BYTES,
      fetchManifest: async () =>
        manifestFor({ integrity: "sha256-mod-vouched-but-wrong" }),
      importBundle,
    });
    expect(outcomes[0].status).toBe("quarantined");
    expect(outcomes[0].reason).toMatch(/hash .* != index/);
    expect(importBundle).not.toHaveBeenCalled();
  });

  it("quarantines with 'unavailable' when the mod reports the third-party Uplink unavailable", async () => {
    const importBundle = vi.fn<
      (bytes: ArrayBuffer, url: string) => Promise<unknown>
    >(async () => ({}));
    stubRegistryFetch(indexWith(goodHash));
    const thirdPartyHash = await sha256Of(THIRD_PARTY_BYTES);
    const roster: RosterEntry[] = [
      {
        id: "widget-y",
        version: "2.0.0",
        available: false,
        reason: "widget-y dependency not installed",
        expectedClientHash: thirdPartyHash,
        clientSource: {
          url: "https://cdn.example/widget-y.client.js",
          devPath: null,
        },
      },
    ];
    const outcomes = await loadEnabledUplinks({
      registrySource: { url: "/uplinks/registry.local.json" },
      hostCompat: HOST,
      appVersion: "1.0.0",
      roster,
      ensureConsent: async () => true,
      fetchBytes: async () => THIRD_PARTY_BYTES,
      fetchManifest: async () => manifestFor({ integrity: thirdPartyHash }),
      importBundle,
    });
    expect(outcomes[0].status).toBe("quarantined");
    expect(outcomes[0].reason).toMatch(/unavailable/);
    expect(importBundle).not.toHaveBeenCalled();
  });

  it("prefers the local first-party descriptor when BOTH it and a clientSource exist for the same id", async () => {
    const importBundle = vi.fn<
      (bytes: ArrayBuffer, url: string) => Promise<unknown>
    >(async () => ({}));
    stubRegistryFetch(indexWith(goodHash)); // "scansat" has a first-party descriptor
    const fetchManifest = vi.fn(async () => manifestFor());
    const roster: RosterEntry[] = [
      {
        id: "scansat",
        version: "1.0.0",
        available: true,
        reason: null,
        // Even with a (nonsense) clientSource present, the first-party
        // descriptor must win, clientSource is only consulted when the
        // local index has NO descriptor for the id.
        clientSource: {
          url: "https://cdn.example/scansat.client.js",
          devPath: null,
        },
      },
    ];
    const outcomes = await loadEnabledUplinks({
      registrySource: { url: "/uplinks/registry.local.json" },
      hostCompat: HOST,
      appVersion: "1.0.0",
      roster,
      ensureConsent: async () => true,
      fetchBytes: async () => BUNDLE_BYTES,
      fetchManifest,
      importBundle,
    });
    expect(outcomes[0].status).toBe("loaded");
    expect(importBundle).toHaveBeenCalledWith(
      IMPORTED_BYTES,
      "/uplinks/scansat.client.js",
    );
    expect(fetchManifest).not.toHaveBeenCalled();
  });
});
