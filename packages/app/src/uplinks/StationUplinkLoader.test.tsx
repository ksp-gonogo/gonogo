/**
 * #6: station boot re-sequence. Covers the two halves of
 * `StationUplinkLoader.tsx`:
 *
 *  - `runStationUplinkLoad`: the pure async orchestration (roster read off a
 *    borrowed `TelemetryClient` -> `loadEnabledUplinks` with `fetchBytes`
 *    routed through the D6 peer conduit). No React needed, a `StubTransport`
 *    stands in for the peer-relayed wire, and a fake `sendBundleFetch`
 *    stands in for `PeerClientService`.
 *  - `StationUplinkLoader`: the component wrapper, gates `children` on the
 *    load settling, and runs the load exactly once.
 *
 * Generic fixture ids ("alpha") on purpose, same reasoning as
 * `rosterProbe.test.ts`'s own header comment: this file must reference no
 * mod token so the uplink-boundary ratchet stays clean. The one place a real
 * first-party id set necessarily comes into play is the roster-ABSENT
 * fallback test, which exercises `runStationUplinkLoad`'s hard-coded
 * `LOADER_UPLINK_IDS`, that test imports the constant and asserts against
 * it rather than typing any of its members as a literal.
 *
 * The whole point of D6/#6 is that a station never fetches a bundle
 * directly: `stubFetch` below throws on any URL that isn't the registry
 * index, so an accidental direct-fetch regression fails LOUDLY (the loader
 * catches the throw and quarantines "load failed", which the assertions
 * below would catch as a wrong status) rather than silently passing.
 */

import { clearRegistry } from "@ksp-gonogo/core";
import {
  StubTransport,
  TelemetryClient,
  TelemetryProvider,
} from "@ksp-gonogo/sitrep-client";
import { render, screen, waitFor } from "@ksp-gonogo/test-utils";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PeerClientProvider } from "../peer/PeerClientContext";
import type { PeerClientService } from "../peer/PeerClientService";
import { setConsentPrompt } from "./consent";
import { LOADER_UPLINK_IDS } from "./flag";
import { hostCompat } from "./hostCompat";
import { __resetUplinkOutcomes, getUplinkOutcomes } from "./loaderState";
import type { RegistryIndex } from "./registry";
import {
  runStationUplinkLoad,
  StationUplinkLoader,
} from "./StationUplinkLoader";

const BUNDLE_SRC = "export const marker = 'station-loaded';";
const BUNDLE_BYTES = new TextEncoder().encode(BUNDLE_SRC).buffer as ArrayBuffer;
// A data: URL so `defaultImportBundle`'s real `import()` at the end of the
// loader sequence resolves without ever touching the stubbed `fetch`, the
// bytes fetched-and-hash-verified (via the conduit) and the bytes actually
// executed by `import()` are deliberately independent in this test, matching
// how the real loader treats them as two separate network reads.
const BUNDLE_URL = `data:text/javascript,${encodeURIComponent(BUNDLE_SRC)}`;

async function sha256Of(bytes: ArrayBuffer): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  const hex = Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return `sha256-${hex}`;
}

/** A single generic ("alpha") Uplink descriptor, gated compatible with the real app hostCompat. */
function registryWith(integrity: string): RegistryIndex {
  return {
    uplinks: [
      {
        id: "alpha",
        name: "Alpha",
        author: "test-fixture",
        repo: "",
        versions: [
          {
            version: "1.0.0",
            minAppVersion: "0.0.0",
            // Read off the real `hostCompat` this module imports rather than
            // typed here. Typed, `uiKitVersion` said "0.1.0" and stayed right
            // only while the constant was ALSO wrong: the moment ui-kit's
            // version was corrected to match its package, four tests failed
            // with a compat mismatch about a number neither side chose.
            // contractMajor/Minor stay 0 because no `__GONOGO_CONTRACT_*__`
            // define exists outside the real Vite build.
            apiVersion: hostCompat.apiVersion,
            uiKitVersion: hostCompat.uiKitVersion,
            contractMajor: hostCompat.contractMajor,
            contractMinor: hostCompat.contractMinor,
            bundleUrl: BUNDLE_URL,
            integrity,
            expectedClientHash: null,
          },
        ],
      },
    ],
  };
}

/** Tracks any fetch NOT for the registry index, must stay empty throughout. */
function stubFetch(index: RegistryIndex): string[] {
  const directBundleFetches: string[] = [];
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
      directBundleFetches.push(String(url));
      throw new Error(
        `unexpected direct fetch (station must never do this): ${url}`,
      );
    }),
  );
  return directBundleFetches;
}

let goodHash: string;

beforeEach(async () => {
  __resetUplinkOutcomes();
  clearRegistry();
  window.localStorage.clear();
  setConsentPrompt(async () => true);
  goodHash = await sha256Of(BUNDLE_BYTES);
});

afterEach(() => {
  vi.unstubAllGlobals();
  window.localStorage.clear();
  setConsentPrompt(async () => false);
});

describe("runStationUplinkLoad", () => {
  it("with no roster sample (timeout), falls back to LOADER_UPLINK_IDS and never makes a direct bundle fetch", async () => {
    // No registry entries match the real first-party ids in this fixture, so
    // every one of them quarantines "not found in the registry index", the
    // point of this test is the ID SET attempted and the total absence of
    // any direct network call, not a successful load.
    const directBundleFetches = stubFetch({ uplinks: [] });
    const stub = new StubTransport();
    const client = new TelemetryClient(stub);
    const sendBundleFetch = vi.fn(async () => BUNDLE_BYTES);

    const outcomes = await runStationUplinkLoad(
      client,
      { sendBundleFetch },
      20,
    );

    expect(outcomes.map((o) => o.id).sort()).toEqual(
      [...LOADER_UPLINK_IDS].sort(),
    );
    expect(outcomes.every((o) => o.status === "quarantined")).toBe(true);
    expect(sendBundleFetch).not.toHaveBeenCalled();
    expect(directBundleFetches).toEqual([]);
  });

  it("loads a compatible Uplink with fetchBytes routed through the peer conduit; never a direct fetch for bundle bytes", async () => {
    const directBundleFetches = stubFetch(registryWith(goodHash));
    const stub = new StubTransport();
    const client = new TelemetryClient(stub);
    const sendBundleFetch = vi.fn(async () => BUNDLE_BYTES);

    const pending = runStationUplinkLoad(client, { sendBundleFetch }, 1000);
    // Roster present and reports "alpha" installed: the registry entry
    // above matches it, so the derived enabled set is exactly ["alpha"].
    stub.emit("system.uplinks", {
      uplinks: [
        { id: "alpha", version: "1.0.0", available: true, reason: null },
      ],
    });

    const outcomes = await pending;
    const alpha = outcomes.find((o) => o.id === "alpha");
    expect(alpha?.status).toBe("loaded");
    expect(sendBundleFetch).toHaveBeenCalledWith(BUNDLE_URL, goodHash);
    expect(directBundleFetches).toEqual([]);
  });

  it("reads the roster off the borrowed TelemetryClient and enforces the mod-hash gate through it", async () => {
    const directBundleFetches = stubFetch(registryWith(goodHash));
    const stub = new StubTransport();
    const client = new TelemetryClient(stub);
    const sendBundleFetch = vi.fn(async () => BUNDLE_BYTES);

    const pending = runStationUplinkLoad(client, { sendBundleFetch }, 1000);
    // The mod vouches for a DIFFERENT hash than the Hub index offers,
    // three-way mismatch, must refuse before ever calling the conduit.
    stub.emit("system.uplinks", {
      uplinks: [
        {
          id: "alpha",
          version: "1.0.0",
          available: true,
          reason: null,
          expectedClientHash: "sha256-not-the-real-hash",
        },
      ],
    });

    const outcomes = await pending;
    const alpha = outcomes.find((o) => o.id === "alpha");
    expect(alpha?.status).toBe("quarantined");
    expect(alpha?.reason).toMatch(/mod expects client/);
    expect(sendBundleFetch).not.toHaveBeenCalled();
    expect(directBundleFetches).toEqual([]);
  });

  it("loads when the mod-vouched hash agrees with the Hub index (full three-way match)", async () => {
    stubFetch(registryWith(goodHash));
    const stub = new StubTransport();
    const client = new TelemetryClient(stub);
    const sendBundleFetch = vi.fn(async () => BUNDLE_BYTES);

    const pending = runStationUplinkLoad(client, { sendBundleFetch }, 1000);
    stub.emit("system.uplinks", {
      uplinks: [
        {
          id: "alpha",
          version: "1.0.0",
          available: true,
          reason: null,
          expectedClientHash: goodHash,
        },
      ],
    });

    const outcomes = await pending;
    const alpha = outcomes.find((o) => o.id === "alpha");
    expect(alpha?.status).toBe("loaded");
    expect(sendBundleFetch).toHaveBeenCalledWith(BUNDLE_URL, goodHash);
  });
});

describe("StationUplinkLoader", () => {
  function Harness({
    client,
    peerClient,
  }: {
    client: TelemetryClient;
    peerClient: PeerClientService;
  }) {
    return (
      <TelemetryProvider client={client}>
        <PeerClientProvider client={peerClient}>
          <StationUplinkLoader rosterTimeoutMs={20}>
            <div data-testid="dashboard-widgets">widgets rendered</div>
          </StationUplinkLoader>
        </PeerClientProvider>
      </TelemetryProvider>
    );
  }

  it("renders a placeholder, then gates children until the loader run settles", async () => {
    stubFetch(registryWith(goodHash));
    const stub = new StubTransport();
    const client = new TelemetryClient(stub);
    const sendBundleFetch = vi.fn(async () => BUNDLE_BYTES);
    const peerClient = { sendBundleFetch } as unknown as PeerClientService;

    render(<Harness client={client} peerClient={peerClient} />);

    expect(screen.queryByTestId("dashboard-widgets")).toBeNull();
    expect(screen.getByText(/Loading station widgets/i)).not.toBeNull();

    await waitFor(() => {
      expect(screen.getByTestId("dashboard-widgets")).not.toBeNull();
    });
    // No roster ever arrives here (timeout at 20ms), falls back to
    // LOADER_UPLINK_IDS, none of which match the "alpha" fixture, so the
    // conduit is never actually called. This test is about the GATE, not
    // the load outcome: see the runStationUplinkLoad describe block above
    // for the load-outcome assertions.
    expect(sendBundleFetch).not.toHaveBeenCalled();
  });

  it("runs the loader exactly once under a StrictMode double-invoke", async () => {
    stubFetch(registryWith(goodHash));
    const stub = new StubTransport();
    const client = new TelemetryClient(stub);
    const sendBundleFetch = vi.fn(async () => BUNDLE_BYTES);
    const peerClient = { sendBundleFetch } as unknown as PeerClientService;

    render(
      <StrictMode>
        <Harness client={client} peerClient={peerClient} />
      </StrictMode>,
    );
    // Deliver the roster so "alpha" is the enabled set, proves the
    // component wiring end-to-end, same as the pure-function tests above.
    stub.emit("system.uplinks", {
      uplinks: [
        { id: "alpha", version: "1.0.0", available: true, reason: null },
      ],
    });

    await waitFor(() => {
      expect(screen.getByTestId("dashboard-widgets")).not.toBeNull();
    });

    // One `sendBundleFetch` call for the one enabled id, a StrictMode-
    // doubled loader run would produce two.
    expect(sendBundleFetch).toHaveBeenCalledTimes(1);
    const outcome = getUplinkOutcomes().find((o) => o.id === "alpha");
    expect(outcome?.status).toBe("loaded");
  });

  it("stays gated (never renders children) while telemetryClient/peerClient aren't both available yet", () => {
    // No PeerClientProvider at all: usePeerClient() resolves null, so the
    // effect must wait rather than starting the load with a missing conduit.
    const stub = new StubTransport();
    const client = new TelemetryClient(stub);
    render(
      <TelemetryProvider client={client}>
        <StationUplinkLoader>
          <div data-testid="dashboard-widgets">widgets rendered</div>
        </StationUplinkLoader>
      </TelemetryProvider>,
    );

    expect(screen.queryByTestId("dashboard-widgets")).toBeNull();
    expect(screen.getByText(/Loading station widgets/i)).not.toBeNull();
  });
});
