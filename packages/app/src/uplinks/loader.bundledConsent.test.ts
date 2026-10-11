import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { HostCompat } from "./hostCompat";
import { loadEnabledUplinks, type RosterEntry } from "./loader";
import { __resetUplinkOutcomes } from "./loaderState";
import type { RegistryIndex } from "./registry";

const HOST: HostCompat = {
  apiVersion: "1.2.0",
  contractMajor: 3,
  contractMinor: 5,
};

const BYTES = new TextEncoder().encode("export const marker = 1;")
  .buffer as ArrayBuffer;
const OTHER_BYTES = new TextEncoder().encode("export const marker = 2;")
  .buffer as ArrayBuffer;

async function sha256Of(bytes: ArrayBuffer): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  const hex = Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return `sha256-${hex}`;
}

function indexWith(integrity: string, bundled: boolean): RegistryIndex {
  return {
    uplinks: [
      {
        id: "widget-x",
        name: "Widget X",
        author: "ksp-gonogo",
        repo: "ksp-gonogo/widget-x",
        ...(bundled ? { bundled: true as const } : {}),
        versions: [
          {
            version: "1.0.0",
            minAppVersion: "1.0.0",
            apiVersion: "1.2.5",
            contractMajor: 3,
            contractMinor: 3,
            bundleUrl: "/uplinks/widget-x.client.js",
            integrity,
            expectedClientHash: null,
          },
        ],
      },
    ],
  };
}

const rosterVouching = (hash: string | null): RosterEntry[] => [
  {
    id: "widget-x",
    version: "1.0.0",
    available: true,
    reason: null,
    expectedClientHash: hash,
  },
];

let goodHash: string;

beforeEach(async () => {
  __resetUplinkOutcomes();
  goodHash = await sha256Of(BYTES);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function load(opts: {
  index: RegistryIndex;
  roster: RosterEntry[];
  bytes?: ArrayBuffer;
}) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => Response.json(opts.index)),
  );
  const ensureConsent = vi.fn(async () => true);
  const importBundle = vi.fn(async () => ({}));
  const outcomes = await loadEnabledUplinks({
    registrySource: { url: "/uplinks/registry.local.json" },
    hostCompat: HOST,
    appVersion: "1.0.0",
    roster: opts.roster,
    fetchBytes: async () => opts.bytes ?? BYTES,
    importBundle,
    ensureConsent,
  });
  return { outcome: outcomes[0], ensureConsent, importBundle };
}

describe("consent for Uplinks bundled in the core mod", () => {
  it("loads a bundled Uplink without a prompt when the mod vouches for the index hash", async () => {
    const { outcome, ensureConsent, importBundle } = await load({
      index: indexWith(goodHash, true),
      roster: rosterVouching(goodHash),
    });
    expect(outcome.status).toBe("loaded");
    expect(ensureConsent).not.toHaveBeenCalled();
    expect(importBundle).toHaveBeenCalledOnce();
  });

  it("refuses a bundled Uplink whose mod-vouched hash differs from the index, without a prompt", async () => {
    const { outcome, ensureConsent, importBundle } = await load({
      index: indexWith(goodHash, true),
      roster: rosterVouching("sha256-something-else"),
    });
    expect(outcome.status).toBe("quarantined");
    expect(ensureConsent).not.toHaveBeenCalled();
    expect(importBundle).not.toHaveBeenCalled();
  });

  it("refuses bundled bytes that miss the vouched hash", async () => {
    const { outcome, importBundle } = await load({
      index: indexWith(goodHash, true),
      roster: rosterVouching(goodHash),
      bytes: OTHER_BYTES,
    });
    expect(outcome.status).toBe("quarantined");
    expect(importBundle).not.toHaveBeenCalled();
  });

  it("still prompts for a bundled Uplink the mod does not vouch for", async () => {
    const { outcome, ensureConsent } = await load({
      index: indexWith(goodHash, true),
      roster: rosterVouching(null),
    });
    expect(ensureConsent).toHaveBeenCalledOnce();
    expect(outcome.status).toBe("loaded");
  });

  it("still prompts for an Uplink that is not bundled, even with a matching vouched hash", async () => {
    const { outcome, ensureConsent } = await load({
      index: indexWith(goodHash, false),
      roster: rosterVouching(goodHash),
    });
    expect(ensureConsent).toHaveBeenCalledOnce();
    expect(outcome.status).toBe("loaded");
  });
});
