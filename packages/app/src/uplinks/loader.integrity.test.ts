/*
 * An integrity failure is a different KIND of event from an ordinary load
 * failure, and this file is where that distinction is held.
 *
 * A compat gate, a declined consent, a dead registry and an unreachable bundle
 * all mean the same disappointing thing: an Uplink will not run here. A hash
 * mismatch means the bytes on the wire are not the bytes that were vouched for.
 * Before this, the only difference between the two was the wording of a
 * free-text `reason`, so nothing downstream could shout about the second
 * without matching prose. `UplinkLoadOutcome.integrity` is what makes them
 * distinguishable, and every case below asserts on the record rather than the
 * sentence.
 */

import type { GonogoUplinkManifest } from "@ksp-gonogo/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { HostCompat } from "./hostCompat";
import { loadEnabledUplinks, type RosterEntry } from "./loader";
import {
  __resetUplinkOutcomes,
  getUplinkOutcomes,
  integrityFailures,
} from "./loaderState";
import type { RegistryIndex } from "./registry";

const HOST: HostCompat = {
  apiVersion: "1.2.0",
  uiKitVersion: "0.3.0",
  contractMajor: 3,
  contractMinor: 5,
};

const BUNDLE_BYTES = new TextEncoder().encode("export const marker = 1;")
  .buffer as ArrayBuffer;

async function sha256Of(bytes: ArrayBuffer): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  const hex = Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return `sha256-${hex}`;
}

function indexWith(
  integrity: string,
  overrides: Partial<RegistryIndex["uplinks"][0]["versions"][0]> = {},
): RegistryIndex {
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
            ...overrides,
          },
        ],
      },
    ],
  };
}

function stubRegistryFetch(index: RegistryIndex | "fail"): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (String(url).includes("registry.local.json")) {
        if (index === "fail") return { ok: false, status: 503 } as Response;
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

const WRONG_HASH = "sha256-0000000000000000000000000000000000000000";

let goodHash: string;

beforeEach(async () => {
  __resetUplinkOutcomes();
  goodHash = await sha256Of(BUNDLE_BYTES);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

interface Overrides {
  index?: RegistryIndex | "fail";
  roster?: RosterEntry[];
  override?: readonly string[];
  ensureConsent?: () => Promise<boolean>;
  fetchBytes?: (url: string, expectedHash?: string) => Promise<ArrayBuffer>;
  fetchManifest?: (url: string) => Promise<unknown>;
}

async function load(overrides: Overrides = {}) {
  stubRegistryFetch(overrides.index ?? indexWith(goodHash));
  return loadEnabledUplinks({
    registrySource: { url: "/uplinks/registry.local.json" },
    override: overrides.roster
      ? undefined
      : (overrides.override ?? ["widget-a"]),
    hostCompat: HOST,
    appVersion: "1.0.0",
    roster: overrides.roster,
    ensureConsent: overrides.ensureConsent ?? (async () => true),
    fetchBytes: overrides.fetchBytes ?? (async () => BUNDLE_BYTES),
    fetchManifest: overrides.fetchManifest,
    importBundle: async () => ({}),
  });
}

/*
 * The deliverable. Each ordinary failure below is quarantined with a reason,
 * exactly as before, and carries NO integrity record, so `integrityFailures`
 * (what the top-of-screen banner reads) stays empty for all of them and is
 * non-empty for the one that matters.
 */
describe("an integrity failure is recorded apart from an ordinary load failure", () => {
  it("records the finding when the fetched bytes miss the hash they were checked against", async () => {
    const [outcome] = await load({ index: indexWith(WRONG_HASH) });

    expect(outcome.status).toBe("quarantined");
    expect(outcome.integrity).toEqual({
      subject: "bundle",
      observed: goodHash,
      expected: WRONG_HASH,
      vouchedBy: ["hub-index"],
    });
    expect(integrityFailures(getUplinkOutcomes())).toHaveLength(1);
  });

  it("records nothing for a compat refusal", async () => {
    const [outcome] = await load({
      index: indexWith(goodHash, { apiVersion: "2.0.0" }),
    });

    expect(outcome.status).toBe("quarantined");
    expect(outcome.reason).toMatch(/apiVersion major mismatch/);
    expect(outcome.integrity).toBeUndefined();
    expect(integrityFailures(getUplinkOutcomes())).toEqual([]);
  });

  it("records nothing for a declined consent", async () => {
    const [outcome] = await load({ ensureConsent: async () => false });

    expect(outcome.reason).toBe("consent declined");
    expect(outcome.integrity).toBeUndefined();
    expect(integrityFailures(getUplinkOutcomes())).toEqual([]);
  });

  it("records nothing for a bundle that could not be fetched", async () => {
    const [outcome] = await load({
      fetchBytes: async () => {
        throw new Error("network unreachable");
      },
    });

    expect(outcome.status).toBe("quarantined");
    expect(outcome.reason).toMatch(/network unreachable/);
    expect(outcome.integrity).toBeUndefined();
    expect(integrityFailures(getUplinkOutcomes())).toEqual([]);
  });

  it("records nothing for an unreadable registry", async () => {
    const [outcome] = await load({ index: "fail" });

    expect(outcome.reason).toMatch(/registry unavailable/);
    expect(outcome.integrity).toBeUndefined();
    expect(integrityFailures(getUplinkOutcomes())).toEqual([]);
  });

  it("records nothing for an Uplink the mod reports unavailable", async () => {
    const [outcome] = await load({
      roster: [
        {
          id: "widget-a",
          version: "1.0.0",
          available: false,
          reason: "Widget A dependency missing",
        },
      ],
    });

    expect(outcome.reason).toMatch(/unavailable/);
    expect(outcome.integrity).toBeUndefined();
    expect(integrityFailures(getUplinkOutcomes())).toEqual([]);
  });

  /*
   * REVERSED, deliberately (2026-09-01). This case used to assert the opposite,
   * that mod/index skew records nothing, on the reasoning that neither side of
   * it is the bundle and the loud surface should not be spent on staleness.
   * The first half of that is still true and is exactly why the record uses the
   * `declaration` subject rather than `bundle`; the conclusion drawn from it
   * was wrong.
   *
   * A surface cannot offer an operator a route past a refusal it cannot
   * identify, and the only alternative identification was matching the reason
   * prose, which this file's own header rules out. So skew now carries a record
   * too, and the two refusals are told apart on `subject`.
   *
   * The concern that produced the old assertion survives in the surface, not
   * here: a banner carrying only declaration findings grades itself down to a
   * warning and says "Hash disagreement", and the critical "Integrity failure"
   * headline still fires only for a measured one. See
   * `UplinkSkewOverride.test.tsx`.
   */
  it("records mod/index version skew as a DECLARATION finding, apart from any bytes", async () => {
    const [outcome] = await load({
      roster: [
        {
          id: "widget-a",
          version: "1.0.0",
          available: true,
          reason: null,
          expectedClientHash: WRONG_HASH,
        },
      ],
    });

    expect(outcome.reason).toMatch(/mod expects client/);
    expect(outcome.integrity).toEqual({
      subject: "declaration",
      observed: goodHash,
      observedBy: ["hub-index"],
      expected: WRONG_HASH,
      vouchedBy: ["installed-mod"],
    });
    // Never `bundle`: no bytes were fetched, and a surface reading this must
    // not be able to mistake it for a bundle that hashed wrong.
    expect(integrityFailures(getUplinkOutcomes())).toHaveLength(1);
  });

  it("records nothing at all for an Uplink that loaded", async () => {
    const [outcome] = await load();

    expect(outcome.status).toBe("loaded");
    expect(outcome.integrity).toBeUndefined();
    expect(integrityFailures(getUplinkOutcomes())).toEqual([]);
  });
});

/*
 * "The index" and "the mod" are different claims and the record has to keep
 * them apart. The first is a bundle disagreeing with its own published
 * descriptor; the second is a bundle disagreeing with the mod the operator
 * installed from CKAN, which is the more serious reading and the one the loader
 * used to leave unsaid.
 */
describe("who an integrity failure names", () => {
  it("names the mod as well as the index when both vouched the hash the bytes missed", async () => {
    const [outcome] = await load({
      index: indexWith(WRONG_HASH),
      roster: [
        {
          id: "widget-a",
          version: "1.0.0",
          available: true,
          reason: null,
          // Agrees with the index, which is the only way past `checkCompat`,
          // so a byte mismatch here disagrees with BOTH parties at once.
          expectedClientHash: WRONG_HASH,
        },
      ],
    });

    expect(outcome.integrity?.vouchedBy).toEqual([
      "installed-mod",
      "hub-index",
    ]);
  });

  it("names only the index when the mod has vouched no hash", async () => {
    const [outcome] = await load({
      index: indexWith(WRONG_HASH),
      roster: [
        { id: "widget-a", version: "1.0.0", available: true, reason: null },
      ],
    });

    expect(outcome.integrity?.vouchedBy).toEqual(["hub-index"]);
  });

  it("names only the mod for a third-party bundle, which has no Hub entry to vouch for it", async () => {
    const manifest: GonogoUplinkManifest = {
      id: "widget-y",
      version: "2.0.0",
      minAppVersion: "1.0.0",
      apiVersion: "1.2.5",
      uiKitVersion: "0.3.9",
      contractMajor: 3,
      contractMinor: 3,
      integrity: WRONG_HASH,
    };
    const [outcome] = await load({
      roster: [
        {
          id: "widget-y",
          version: "2.0.0",
          available: true,
          reason: null,
          expectedClientHash: WRONG_HASH,
          clientSource: {
            url: "https://cdn.example/widget-y.client.js",
            devPath: null,
          },
        },
      ],
      fetchManifest: async () => manifest,
    });

    expect(outcome.integrity).toEqual({
      subject: "bundle",
      observed: goodHash,
      expected: WRONG_HASH,
      vouchedBy: ["installed-mod"],
    });
  });

  it("names the manifest as the subject when the sidecar disagrees before any bytes are fetched", async () => {
    const fetchBytes = vi.fn(async () => BUNDLE_BYTES);
    const [outcome] = await load({
      roster: [
        {
          id: "widget-y",
          version: "2.0.0",
          available: true,
          reason: null,
          expectedClientHash: WRONG_HASH,
          clientSource: {
            url: "https://cdn.example/widget-y.client.js",
            devPath: null,
          },
        },
      ],
      fetchManifest: async () => ({
        id: "widget-y",
        version: "2.0.0",
        minAppVersion: "1.0.0",
        apiVersion: "1.2.5",
        uiKitVersion: "0.3.9",
        contractMajor: 3,
        contractMinor: 3,
        integrity: "sha256-manifest-disagrees",
      }),
      fetchBytes,
    });

    expect(outcome.integrity).toEqual({
      subject: "manifest",
      observed: "sha256-manifest-disagrees",
      expected: WRONG_HASH,
      vouchedBy: ["installed-mod"],
    });
    expect(fetchBytes).not.toHaveBeenCalled();
  });
});

/*
 * The record is additive: the reason string is still the diagnostic line, and
 * still says what it always said. Losing it would trade one legible surface for
 * another rather than adding one.
 */
describe("the reason string survives alongside the record", () => {
  it("keeps the raw hashes in the reason a quarantined row already shows", async () => {
    const [outcome] = await load({ index: indexWith(WRONG_HASH) });

    expect(outcome.reason).toBe(
      `bundle hash ${goodHash} != index ${WRONG_HASH} (tampered or wrong URL)`,
    );
  });

  /*
   * The arming half of the three-way check, which had never fired for a bundled
   * Uplink: every `ExpectedClientHash.g.cs` in the tree read `""` until
   * 2026-09-01, so `roster.expectedClientHash` was null everywhere and no load
   * could ever produce a finding against the mod. With a real hash baked, an
   * operator whose bundle does not match their installed mod has to be told
   * that, not told a catalogue entry disagrees.
   */
  it("names the MOD, not the index, when an armed mod vouched the hash the bytes missed", async () => {
    const [outcome] = await load({
      index: indexWith(WRONG_HASH),
      roster: [
        {
          id: "widget-a",
          version: "1.0.0",
          available: true,
          reason: null,
          expectedClientHash: WRONG_HASH,
        },
      ],
    });

    expect(outcome.status).toBe("quarantined");
    expect(outcome.reason).toBe(
      `bundle hash ${goodHash} != mod-expected ${WRONG_HASH} (tampered or wrong URL)`,
    );
    expect(outcome.integrity?.vouchedBy).toContain("installed-mod");
  });
});
