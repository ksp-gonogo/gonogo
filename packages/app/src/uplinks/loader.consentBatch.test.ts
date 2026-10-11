/*
 * The loader asks every Uplink's consent question on one page. Each load runs
 * as far as its consent gate, the questions are asked together once every load
 * has reached the gate or stopped short of it, and the imports then run one at
 * a time in roster order.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type ConsentInfo, setConsentBatchPrompt } from "./consent";
import type { HostCompat } from "./hostCompat";
import { loadEnabledUplinks } from "./loader";
import { __resetUplinkOutcomes } from "./loaderState";
import type { RegistryIndex } from "./registry";

const HOST: HostCompat = {
  apiVersion: "1.2.0",
  contractMajor: 3,
  contractMinor: 5,
};

const BYTES = new TextEncoder().encode("export const marker = 1;")
  .buffer as ArrayBuffer;

async function sha256Of(bytes: ArrayBuffer): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  const hex = Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return `sha256-${hex}`;
}

function entry(id: string, integrity: string, contractMajor = 3) {
  return {
    id,
    name: id.toUpperCase(),
    author: "someone",
    repo: `example/${id}`,
    versions: [
      {
        version: "1.0.0",
        minAppVersion: "1.0.0",
        apiVersion: "1.2.0",
        contractMajor,
        contractMinor: 3,
        bundleUrl: `/uplinks/${id}.client.js`,
        integrity,
        expectedClientHash: null,
      },
    ],
  };
}

async function load(
  index: RegistryIndex,
  ids: readonly string[],
  fetchBytes: (url: string) => Promise<ArrayBuffer> = async () => BYTES,
) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => Response.json(index)),
  );
  const imported: string[] = [];
  const outcomes = await loadEnabledUplinks({
    registrySource: { url: "/uplinks/registry.local.json" },
    override: ids,
    hostCompat: HOST,
    appVersion: "1.0.0",
    fetchBytes,
    importBundle: async (_bytes, url) => {
      imported.push(url);
      return {};
    },
  });
  return { outcomes, imported };
}

let hash: string;

beforeEach(async () => {
  __resetUplinkOutcomes();
  localStorage.clear();
  hash = await sha256Of(BYTES);
});

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe("consent across several Uplinks", () => {
  it("asks every question once, together, and imports in roster order", async () => {
    const batch = vi.fn(async (infos: readonly ConsentInfo[]) =>
      infos.map((info) => info.id !== "beta"),
    );
    setConsentBatchPrompt(batch);

    const { outcomes, imported } = await load(
      {
        uplinks: [
          entry("alpha", hash),
          entry("beta", hash),
          entry("gamma", hash),
        ],
      },
      ["alpha", "beta", "gamma"],
    );

    expect(batch).toHaveBeenCalledOnce();
    expect(batch.mock.calls[0]?.[0].map((info) => info.id)).toEqual([
      "alpha",
      "beta",
      "gamma",
    ]);
    expect(outcomes.map((o) => [o.id, o.status])).toEqual([
      ["alpha", "loaded"],
      ["beta", "quarantined"],
      ["gamma", "loaded"],
    ]);
    expect(imported).toEqual([
      "/uplinks/alpha.client.js",
      "/uplinks/gamma.client.js",
    ]);
  });

  it("keeps roster order when an earlier Uplink is declined and the first is slow to download", async () => {
    setConsentBatchPrompt(async (infos) =>
      infos.map((info) => info.id !== "beta"),
    );

    const { imported } = await load(
      {
        uplinks: [
          entry("alpha", hash),
          entry("beta", hash),
          entry("gamma", hash),
        ],
      },
      ["alpha", "beta", "gamma"],
      async (url) => {
        if (url.includes("alpha")) await new Promise((r) => setTimeout(r, 30));
        return BYTES;
      },
    );

    expect(imported).toEqual([
      "/uplinks/alpha.client.js",
      "/uplinks/gamma.client.js",
    ]);
  });

  it("does not wait on, or ask about, an Uplink refused before its gate", async () => {
    const batch = vi.fn(async (infos: readonly ConsentInfo[]) =>
      infos.map(() => true),
    );
    setConsentBatchPrompt(batch);

    const { outcomes } = await load(
      { uplinks: [entry("alpha", hash, 9), entry("beta", hash)] },
      ["alpha", "beta"],
    );

    expect(batch.mock.calls[0]?.[0].map((info) => info.id)).toEqual(["beta"]);
    expect(outcomes.map((o) => o.status)).toEqual(["quarantined", "loaded"]);
  });

  it("asks nothing on a later load once every answer is remembered", async () => {
    const batch = vi.fn(async (infos: readonly ConsentInfo[]) =>
      infos.map((info) => info.id === "alpha"),
    );
    setConsentBatchPrompt(batch);
    const index = { uplinks: [entry("alpha", hash), entry("beta", hash)] };

    await load(index, ["alpha", "beta"]);
    __resetUplinkOutcomes();
    const again = await load(index, ["alpha", "beta"]);

    expect(batch).toHaveBeenCalledOnce();
    expect(again.outcomes.map((o) => o.status)).toEqual([
      "loaded",
      "quarantined",
    ]);
  });
});
