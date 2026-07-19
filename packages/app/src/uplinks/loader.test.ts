import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { HostCompat } from "./hostCompat";
import { loadEnabledUplinks, loadUplinkById, type RosterEntry } from "./loader";
import { __resetUplinkOutcomes, getUplinkOutcomes } from "./loaderState";
import type { RegistryIndex } from "./registry";

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
            apiVersion: "1.5.0", // same major as host 1.2.0 → passes
            uiKitVersion: "0.3.9", // same major as host 0.3.0 → passes
            contractMajor: 3,
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
  importBundle: (url: string) => Promise<unknown>;
  ensureConsent?: (info: { id: string }) => Promise<boolean>;
  fetchBytes?: (url: string) => Promise<ArrayBuffer>;
}) {
  stubRegistryFetch(extra.index);
  return {
    registrySource: { url: "/uplinks/registry.local.json" },
    enabledIds: ["scansat"],
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
  it("loads a verified, compatible Uplink and imports its bundle", async () => {
    const importBundle = vi.fn<(url: string) => Promise<unknown>>(
      async () => ({}),
    );
    const outcomes = await loadEnabledUplinks(
      ctx({ index: indexWith(goodHash), importBundle }),
    );
    expect(outcomes[0].status).toBe("loaded");
    expect(importBundle).toHaveBeenCalledWith("/uplinks/scansat.client.js");
    expect(getUplinkOutcomes()[0].status).toBe("loaded");
  });

  it("quarantines on a bundle-hash mismatch and never imports", async () => {
    const importBundle = vi.fn<(url: string) => Promise<unknown>>(
      async () => ({}),
    );
    const outcomes = await loadEnabledUplinks(
      ctx({ index: indexWith("sha256-deadbeef"), importBundle }),
    );
    expect(outcomes[0].status).toBe("quarantined");
    expect(outcomes[0].reason).toMatch(/hash .* != index/);
    expect(importBundle).not.toHaveBeenCalled();
  });

  it("refuses an apiVersion major mismatch BEFORE fetching bytes", async () => {
    const importBundle = vi.fn<(url: string) => Promise<unknown>>(
      async () => ({}),
    );
    const fetchBytes = vi.fn<(url: string) => Promise<ArrayBuffer>>(
      async () => BUNDLE_BYTES,
    );
    stubRegistryFetch(indexWith(goodHash, { apiVersion: "2.0.0" }));
    const outcomes = await loadEnabledUplinks({
      registrySource: { url: "/uplinks/registry.local.json" },
      enabledIds: ["scansat"],
      hostCompat: HOST,
      appVersion: "1.0.0",
      ensureConsent: async () => true,
      fetchBytes,
      importBundle,
    });
    expect(outcomes[0].status).toBe("quarantined");
    expect(outcomes[0].reason).toMatch(/apiVersion incompatible/);
    expect(fetchBytes).not.toHaveBeenCalled();
    expect(importBundle).not.toHaveBeenCalled();
  });

  it("refuses a contractMajor mismatch", async () => {
    const importBundle = vi.fn<(url: string) => Promise<unknown>>(
      async () => ({}),
    );
    const outcomes = await loadEnabledUplinks(
      ctx({ index: indexWith(goodHash, { contractMajor: 2 }), importBundle }),
    );
    expect(outcomes[0].status).toBe("quarantined");
    expect(outcomes[0].reason).toMatch(/contractMajor incompatible/);
  });

  it("refuses when the live mod reports the Uplink unavailable", async () => {
    const importBundle = vi.fn<(url: string) => Promise<unknown>>(
      async () => ({}),
    );
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
    const importBundle = vi.fn<(url: string) => Promise<unknown>>(
      async () => ({}),
    );
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
    const importBundle = vi.fn<(url: string) => Promise<unknown>>(
      async () => ({}),
    );
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
    const importBundle = vi.fn<(url: string) => Promise<unknown>>(
      async () => ({}),
    );
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
    const importBundle = vi.fn<(url: string) => Promise<unknown>>(
      async () => ({}),
    );
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
    const importBundle = vi.fn<(url: string) => Promise<unknown>>(
      async () => ({}),
    );
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
    const importBundle = vi.fn<(url: string) => Promise<unknown>>(
      async () => ({}),
    );
    const outcomes = await loadEnabledUplinks(
      ctx({ index: "fail", importBundle }),
    );
    expect(outcomes[0].status).toBe("quarantined");
    expect(outcomes[0].reason).toMatch(/registry unavailable/);
    expect(importBundle).not.toHaveBeenCalled();
  });

  it("quarantines an enabled id absent from the index", async () => {
    const importBundle = vi.fn<(url: string) => Promise<unknown>>(
      async () => ({}),
    );
    stubRegistryFetch({ uplinks: [] });
    const outcomes = await loadEnabledUplinks({
      registrySource: { url: "/uplinks/registry.local.json" },
      enabledIds: ["scansat"],
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

describe("loadUplinkById", () => {
  it("fetches the registry and loads only the requested id", async () => {
    const importBundle = vi.fn<(url: string) => Promise<unknown>>(
      async () => ({}),
    );
    const outcome = await loadUplinkById(
      "scansat",
      ctx({ index: indexWith(goodHash), importBundle }),
    );
    expect(outcome.status).toBe("loaded");
    expect(outcome.id).toBe("scansat");
    expect(importBundle).toHaveBeenCalledWith("/uplinks/scansat.client.js");
    expect(getUplinkOutcomes()[0].status).toBe("loaded");
  });

  it("reuses the ensureConsent/fetchBytes/importBundle DI seam", async () => {
    const importBundle = vi.fn<(url: string) => Promise<unknown>>(
      async () => ({}),
    );
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
    const importBundle = vi.fn<(url: string) => Promise<unknown>>(
      async () => ({}),
    );
    stubRegistryFetch(indexWith(goodHash));
    const outcome = await loadUplinkById("kos", {
      registrySource: { url: "/uplinks/registry.local.json" },
      enabledIds: [],
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
    const importBundle = vi.fn<(url: string) => Promise<unknown>>(
      async () => ({}),
    );
    const outcome = await loadUplinkById(
      "scansat",
      ctx({ index: "fail", importBundle }),
    );
    expect(outcome.status).toBe("quarantined");
    expect(outcome.reason).toMatch(/registry unavailable/);
    expect(importBundle).not.toHaveBeenCalled();
  });
});
