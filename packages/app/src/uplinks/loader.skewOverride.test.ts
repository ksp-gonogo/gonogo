/*
 * The escape hatch, and its limit.
 *
 * Two refusals in the loader disagree about a hash and they are not the same
 * event. The PRE-FETCH one is two parties describing different builds with
 * nothing downloaded, which is what a dev-channel app and a release-channel mod
 * look like from here. The POST-FETCH one is bytes that hash to something no
 * party vouched for, which nobody honest produces.
 *
 * This file holds the line between them. The first can be loaded past on a
 * recorded per-id, per-version, per-hash-pair operator decision, and the bundle
 * is STILL hashed against the index before it runs. The second cannot be loaded
 * past at all, and the last case here plants an override key against a
 * byte-mismatch to prove that an override recorded by any means whatsoever does
 * not reach it.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { HostCompat } from "./hostCompat";
import type { UplinkIntegrityFailure } from "./integrity";
import { loadEnabledUplinks, type RosterEntry } from "./loader";
import { __resetUplinkOutcomes } from "./loaderState";
import type { RegistryIndex } from "./registry";
import {
  __resetSkewOverrides,
  grantSkewOverride,
  hasSkewOverride,
  skewOverrideKey,
} from "./skewOverride";

const HOST: HostCompat = {
  apiVersion: "1.2.0",
  uiKitVersion: "0.3.0",
  contractMajor: 3,
  contractMinor: 5,
};

const BUNDLE_BYTES = new TextEncoder().encode("export const marker = 1;")
  .buffer as ArrayBuffer;

/** The hash the mod bakes: a real build, just not the one the index offers. */
const MOD_HASH = "sha256-1111111111111111111111111111111111111111";
const WRONG_HASH = "sha256-2222222222222222222222222222222222222222";

async function sha256Of(bytes: ArrayBuffer): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return `sha256-${Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")}`;
}

function indexWith(integrity: string): RegistryIndex {
  return {
    uplinks: [
      {
        id: "widget-a",
        name: "Widget A",
        author: "jonpepler",
        repo: "example/widget-a",
        versions: [
          {
            version: "1.0.0",
            minAppVersion: "1.0.0",
            apiVersion: "1.2.5",
            uiKitVersion: "0.3.9",
            contractMajor: 3,
            contractMinor: 3,
            bundleUrl: "/uplinks/widget-a.client.js",
            integrity,
            expectedClientHash: null,
          },
        ],
      },
    ],
  };
}

function rosterWith(expectedClientHash: string): RosterEntry[] {
  return [
    {
      id: "widget-a",
      version: "1.0.0",
      available: true,
      reason: null,
      expectedClientHash,
    },
  ];
}

function stubRegistryFetch(index: RegistryIndex): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (String(url).includes("registry.local.json")) {
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

/** The declaration finding the loader records for MOD_HASH vs `indexHash`. */
function skewFailure(indexHash: string): UplinkIntegrityFailure {
  return {
    subject: "declaration",
    observed: indexHash,
    observedBy: ["hub-index"],
    expected: MOD_HASH,
    vouchedBy: ["installed-mod"],
  };
}

let goodHash: string;
let importBundle: ReturnType<typeof vi.fn>;
let fetchBytes: ReturnType<typeof vi.fn>;

beforeEach(async () => {
  __resetUplinkOutcomes();
  __resetSkewOverrides();
  goodHash = await sha256Of(BUNDLE_BYTES);
  importBundle = vi.fn(async () => ({}));
  fetchBytes = vi.fn(async () => BUNDLE_BYTES);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function load(index: RegistryIndex, roster: RosterEntry[]) {
  stubRegistryFetch(index);
  const [outcome] = await loadEnabledUplinks({
    registrySource: { url: "/uplinks/registry.local.json" },
    hostCompat: HOST,
    appVersion: "1.0.0",
    roster,
    ensureConsent: async () => true,
    fetchBytes: fetchBytes as never,
    importBundle: importBundle as never,
  });
  return outcome;
}

describe("the pre-fetch skew refusal is recorded as a DECLARATION finding", () => {
  it("carries both hashes and both parties, so a surface can read it as skew", async () => {
    const outcome = await load(indexWith(goodHash), rosterWith(MOD_HASH));

    expect(outcome.status).toBe("quarantined");
    expect(outcome.integrity).toEqual(skewFailure(goodHash));
    expect(fetchBytes).not.toHaveBeenCalled();
    expect(importBundle).not.toHaveBeenCalled();
  });

  /*
   * The regression this exists to hold. Before the override work the arm called
   * plain `refuse`, so the outcome carried a reason string and nothing else, and
   * a surface could not tell skew from a compat gate without matching prose.
   */
  it("is not merely a reason string", async () => {
    const outcome = await load(indexWith(goodHash), rosterWith(MOD_HASH));

    expect(outcome.reason).toMatch(/mod expects client/);
    expect(outcome.integrity).toBeDefined();
  });
});

describe("an operator override loads past the skew", () => {
  it("loads the client the index offers once the decision is recorded", async () => {
    grantSkewOverride("widget-a", "1.0.0", skewFailure(goodHash));

    const outcome = await load(indexWith(goodHash), rosterWith(MOD_HASH));

    expect(outcome.status).toBe("loaded");
    expect(importBundle).toHaveBeenCalledOnce();
  });

  it("says on the loaded row that it ran on an override, naming both hashes", async () => {
    grantSkewOverride("widget-a", "1.0.0", skewFailure(goodHash));

    const outcome = await load(indexWith(goodHash), rosterWith(MOD_HASH));

    expect(outcome.reason).toContain("operator skew override");
    expect(outcome.reason).toContain(MOD_HASH);
    expect(outcome.reason).toContain(goodHash);
  });

  /*
   * The safety argument in one case: accepting skew picks WHICH party anchors
   * the byte check, it does not remove the check. The index here offers a hash
   * the bundle does not have, so the bundle is refused exactly as it would be
   * with no override in play.
   */
  it("still refuses the bytes when they miss the index hash", async () => {
    grantSkewOverride("widget-a", "1.0.0", skewFailure(WRONG_HASH));

    const outcome = await load(indexWith(WRONG_HASH), rosterWith(MOD_HASH));

    expect(outcome.status).toBe("quarantined");
    expect(outcome.integrity).toEqual({
      subject: "bundle",
      observed: goodHash,
      expected: WRONG_HASH,
      vouchedBy: ["hub-index"],
    });
    expect(importBundle).not.toHaveBeenCalled();
  });
});

describe("an override is bound to the pair the operator read", () => {
  it("does not carry to a different index hash for the same id and version", async () => {
    grantSkewOverride("widget-a", "1.0.0", skewFailure(WRONG_HASH));

    // Same id, same version, same mod hash: the index now offers a DIFFERENT
    // build from the one the operator accepted, so the refusal comes back.
    const outcome = await load(indexWith(goodHash), rosterWith(MOD_HASH));

    expect(outcome.status).toBe("quarantined");
    expect(outcome.integrity?.subject).toBe("declaration");
    expect(importBundle).not.toHaveBeenCalled();
  });

  it("does not carry to a different mod hash for the same id and version", async () => {
    grantSkewOverride("widget-a", "1.0.0", skewFailure(goodHash));

    const otherMod = "sha256-3333333333333333333333333333333333333333";
    const outcome = await load(indexWith(goodHash), rosterWith(otherMod));

    expect(outcome.status).toBe("quarantined");
    expect(outcome.integrity?.subject).toBe("declaration");
    expect(importBundle).not.toHaveBeenCalled();
  });

  it("keys on id, version and both hashes together", () => {
    const failure = skewFailure(goodHash);
    const key = skewOverrideKey("widget-a", "1.0.0", failure);

    expect(key).toContain("widget-a@1.0.0");
    expect(key).toContain(MOD_HASH);
    expect(key).toContain(goodHash);
  });
});

describe("a measured byte mismatch cannot be overridden", () => {
  const bytesMismatch: UplinkIntegrityFailure = {
    subject: "bundle",
    observed: "sha256-4444444444444444444444444444444444444444",
    expected: WRONG_HASH,
    vouchedBy: ["hub-index"],
  };

  it("refuses to record a decision about it", () => {
    expect(() => grantSkewOverride("widget-a", "1.0.0", bytesMismatch)).toThrow(
      /cannot be overridden/,
    );
  });

  it("reads as un-overridden even when a key for it sits in storage", () => {
    /*
     * Plant the key by hand: the guard in `grantSkewOverride` is one layer, and
     * a hand-written localStorage entry is what it would take to get past it.
     * `hasSkewOverride` must refuse on the finding's KIND regardless.
     */
    window.localStorage.setItem(
      "gonogo.uplinkSkewOverride",
      JSON.stringify([skewOverrideKey("widget-a", "1.0.0", bytesMismatch)]),
    );

    expect(hasSkewOverride("widget-a", "1.0.0", bytesMismatch)).toBe(false);
  });

  it("still quarantines the bundle with a planted key in storage", async () => {
    const failure: UplinkIntegrityFailure = {
      subject: "bundle",
      observed: goodHash,
      expected: WRONG_HASH,
      vouchedBy: ["hub-index"],
    };
    window.localStorage.setItem(
      "gonogo.uplinkSkewOverride",
      JSON.stringify([
        skewOverrideKey("widget-a", "1.0.0", failure),
        /*
         * And the declaration key too, so the pre-fetch gate is genuinely
         * passed and the run reaches the byte check rather than stopping short
         * of it: the refusal below is the POST-fetch one.
         */
        skewOverrideKey("widget-a", "1.0.0", skewFailure(WRONG_HASH)),
      ]),
    );

    const outcome = await load(indexWith(WRONG_HASH), rosterWith(MOD_HASH));

    expect(outcome.status).toBe("quarantined");
    expect(outcome.integrity).toEqual(failure);
    expect(fetchBytes).toHaveBeenCalledOnce();
    expect(importBundle).not.toHaveBeenCalled();
  });
});
