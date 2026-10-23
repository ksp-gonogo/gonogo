/**
 * #6: station boot re-sequence. Covers the two halves of
 * `StationUplinkLoader.tsx`:
 *
 *  - `runStationUplinkLoad`: the pure async orchestration (roster read off a
 *    borrowed `TelemetryClient` -> `loadEnabledUplinks` with `fetchBytes`
 *    routed through the D6 peer conduit). No React needed, a `StubTransport`
 *    stands in for the peer-relayed wire, and a fake `sendBundleFetch`
 *    stands in for `PeerClientService`.
 *  - `StationUplinkLoader`: the component wrapper, gates `children` on every
 *    Uplink of the main screen's set being loaded, and runs the load once.
 *
 * Generic fixture ids ("alpha") on purpose, same reasoning as
 * `rosterProbe.test.ts`'s own header comment: this file must reference no
 * mod token so the uplink-boundary ratchet stays clean. Nothing here needs a
 * real first-party id any more: a roster-ABSENT station boot attempts nothing
 * at all, there is no shipped id list for it to fall back to.
 *
 * The whole point of D6/#6 is that a station never fetches a bundle
 * directly: `stubFetch` below throws on any URL that isn't the registry
 * index, so an accidental direct-fetch regression fails loudly (the loader
 * catches the throw and quarantines "load failed", which the assertions
 * below would catch as a wrong status) rather than silently passing.
 */

import { clearRegistry } from "@ksp-gonogo/core";
import { TelemetryClient, TelemetryProvider } from "@ksp-gonogo/sitrep-client";
import { StubTransport } from "@ksp-gonogo/sitrep-sdk/testing";
import { act, render, screen, waitFor, within } from "@ksp-gonogo/test-utils";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type PeerClient, PeerClientProvider } from "../peer/PeerClientContext";
import { idlePeerClient } from "../test/peerFakes";
import { setConsentPrompt } from "./consent";
import { hostCompat } from "./hostCompat";
import {
  __resetUplinkOutcomes,
  getUplinkOutcomes,
  type RunningUplink,
} from "./loaderState";
import type { RegistryIndex } from "./registry";
import { decodeRosterPayload } from "./rosterProbe";
import {
  followHostUplinks,
  loadWithArrivedRoster,
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

/** Generic ("alpha", "beta") Uplink descriptors, gated compatible with the real app hostCompat. */
function registryWith(integrity: string): RegistryIndex {
  return {
    uplinks: ["alpha", "beta"].map((id) => ({
      id,
      name: id,
      author: "test-fixture",
      repo: "",
      versions: [
        {
          version: "1.0.0",
          minAppVersion: "0.0.0",
          // Read off the real `hostCompat` this module imports rather than typed here, so a test cannot pass or fail on a number neither side chose; the contract pair stays 0 because no `__GONOGO_CONTRACT_*__` define exists outside the real Vite build.
          apiVersion: hostCompat.apiVersion,
          contractMajor: hostCompat.contractMajor,
          contractMinor: hostCompat.contractMinor,
          bundleUrl: BUNDLE_URL,
          integrity,
          expectedClientHash: null,
        },
      ],
    })),
  };
}

/** Tracks any fetch not for the registry index, must stay empty throughout. */
function stubFetch(index: RegistryIndex): string[] {
  const directBundleFetches: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (String(url).includes("registry.local.json")) {
        return Response.json(index);
      }
      directBundleFetches.push(String(url));
      throw new Error(
        `unexpected direct fetch (station must never do this): ${url}`,
      );
    }),
  );
  return directBundleFetches;
}

const noManifest = vi.fn(async () => {
  throw new Error("a first-party Uplink has no manifest to fetch");
});

let goodHash: string;

const ALPHA_RUNS = [{ id: "alpha", version: "1.0.0" }];

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

/**
 * A station peer link whose bundle conduit is the one under test, and whose
 * main screen says it runs `runs` (nothing said when absent). `announce` sends
 * a later set.
 */
function peerClientWith(
  sendBundleFetch: PeerClient["sendBundleFetch"],
  runs?: RunningUplink[],
): PeerClient & { announce: (set: RunningUplink[]) => void } {
  let current: RunningUplink[] | null = runs ?? null;
  const listeners = new Set<(set: RunningUplink[] | null) => void>();
  return {
    ...idlePeerClient(),
    sendBundleFetch,
    onHostUplinksChange: (cb) => {
      listeners.add(cb);
      cb(current);
      return () => listeners.delete(cb);
    },
    announce: (set) => {
      current = set;
      for (const cb of listeners) cb(set);
    },
  };
}

describe("runStationUplinkLoad", () => {
  it("with an empty set from the main screen, attempts nothing and never makes a direct bundle fetch", async () => {
    const directBundleFetches = stubFetch(registryWith(goodHash));
    const stub = new StubTransport();
    const client = new TelemetryClient(stub);
    const sendBundleFetch = vi.fn(async () => BUNDLE_BYTES);

    const outcomes = await runStationUplinkLoad(
      client,
      { sendBundleFetch, sendManifestFetch: noManifest },
      [],
      20,
    );

    expect(outcomes).toEqual([]);
    expect(getUplinkOutcomes()).toHaveLength(0);
    expect(sendBundleFetch).not.toHaveBeenCalled();
    expect(directBundleFetches).toEqual([]);
  });

  it("loads a compatible Uplink with fetchBytes routed through the peer conduit; never a direct fetch for bundle bytes", async () => {
    const directBundleFetches = stubFetch(registryWith(goodHash));
    const stub = new StubTransport();
    const client = new TelemetryClient(stub);
    const sendBundleFetch = vi.fn(async () => BUNDLE_BYTES);

    const pending = runStationUplinkLoad(
      client,
      { sendBundleFetch, sendManifestFetch: noManifest },
      ALPHA_RUNS,
      1000,
      async () => ({}),
    );
    // Roster present and reports "alpha" installed: the registry entry above matches it, so the derived enabled set is exactly ["alpha"].
    stub.emit("system.uplinks", {
      uplinks: [
        { id: "alpha", version: "1.0.0", available: true, reason: null },
      ],
    });

    const outcomes = await pending;
    const alpha = outcomes.find((o) => o.id === "alpha");
    expect(alpha?.status).toBe("loaded");
    expect(sendBundleFetch).toHaveBeenCalledWith(
      BUNDLE_URL,
      goodHash,
      expect.anything(),
    );
    expect(directBundleFetches).toEqual([]);
  });

  it("reads the roster off the borrowed TelemetryClient and enforces the mod-hash gate through it", async () => {
    const directBundleFetches = stubFetch(registryWith(goodHash));
    const stub = new StubTransport();
    const client = new TelemetryClient(stub);
    const sendBundleFetch = vi.fn(async () => BUNDLE_BYTES);

    const pending = runStationUplinkLoad(
      client,
      { sendBundleFetch, sendManifestFetch: noManifest },
      ALPHA_RUNS,
      1000,
      async () => ({}),
    );
    // The mod vouches for a DIFFERENT hash than the Hub index offers, three-way mismatch, must refuse before ever calling the conduit.
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

    const pending = runStationUplinkLoad(
      client,
      { sendBundleFetch, sendManifestFetch: noManifest },
      ALPHA_RUNS,
      1000,
      async () => ({}),
    );
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
    expect(sendBundleFetch).toHaveBeenCalledWith(
      BUNDLE_URL,
      goodHash,
      expect.anything(),
    );
  });
});

describe("a station loads exactly what its main screen runs", () => {
  const roster = {
    uplinks: ["alpha", "beta"].map((id) => ({
      id,
      version: "1.0.0",
      available: true,
      reason: null,
    })),
  };

  it("leaves out an installed Uplink the main screen does not run", async () => {
    stubFetch(registryWith(goodHash));
    const stub = new StubTransport();
    const client = new TelemetryClient(stub);
    const sendBundleFetch = vi.fn(async () => BUNDLE_BYTES);

    const pending = runStationUplinkLoad(
      client,
      { sendBundleFetch, sendManifestFetch: noManifest },
      ALPHA_RUNS,
      1000,
      async () => ({}),
    );
    stub.emit("system.uplinks", roster);

    const outcomes = await pending;
    expect(outcomes.map((o) => [o.id, o.status])).toEqual([
      ["alpha", "loaded"],
    ]);
    expect(sendBundleFetch).toHaveBeenCalledOnce();
  });

  it("refuses an Uplink the main screen runs at another version", async () => {
    stubFetch(registryWith(goodHash));
    const stub = new StubTransport();
    const client = new TelemetryClient(stub);
    const sendBundleFetch = vi.fn(async () => BUNDLE_BYTES);

    const pending = runStationUplinkLoad(
      client,
      { sendBundleFetch, sendManifestFetch: noManifest },
      [{ id: "alpha", version: "2.0.0" }],
      1000,
      async () => ({}),
    );
    stub.emit("system.uplinks", roster);

    const [alpha] = await pending;
    expect(alpha.status).toBe("quarantined");
    expect(alpha.reason).toBe(
      "the main screen runs version 2.0.0 and this station has 1.0.0",
    );
    expect(sendBundleFetch).not.toHaveBeenCalled();
  });

  it("loads what a new set adds, and reloads when the set drops one it loaded", async () => {
    stubFetch(registryWith(goodHash));
    const stub = new StubTransport();
    const client = new TelemetryClient(stub);
    stub.emit("system.uplinks", roster);
    const sendBundleFetch = vi.fn(async () => BUNDLE_BYTES);
    const reload = vi.fn();
    const both = [...ALPHA_RUNS, { id: "beta", version: "1.0.0" }];

    await runStationUplinkLoad(
      client,
      { sendBundleFetch, sendManifestFetch: noManifest },
      ALPHA_RUNS,
      1000,
      async () => ({}),
    );
    const added = await followHostUplinks(
      client,
      { sendBundleFetch, sendManifestFetch: noManifest },
      both,
      reload,
      1000,
      async () => ({}),
    );
    expect(added.map((o) => [o.id, o.status])).toEqual([["beta", "loaded"]]);
    expect(reload).not.toHaveBeenCalled();

    await followHostUplinks(
      client,
      { sendBundleFetch, sendManifestFetch: noManifest },
      ALPHA_RUNS,
      reload,
      1000,
    );
    expect(reload).toHaveBeenCalledOnce();
  });
});

describe("StationUplinkLoader", () => {
  function Harness({
    client,
    peerClient,
  }: {
    client: TelemetryClient;
    peerClient: PeerClient;
  }) {
    return (
      <TelemetryProvider client={client}>
        <PeerClientProvider client={peerClient}>
          <StationUplinkLoader
            rosterTimeoutMs={20}
            importBundle={async () => ({})}
          >
            <div data-testid="dashboard-widgets">widgets rendered</div>
          </StationUplinkLoader>
        </PeerClientProvider>
      </TelemetryProvider>
    );
  }

  it("stays blocked until the main screen says which Uplinks it runs, then opens on an empty set", async () => {
    stubFetch(registryWith(goodHash));
    const stub = new StubTransport();
    const client = new TelemetryClient(stub);
    const sendBundleFetch = vi.fn(async () => BUNDLE_BYTES);
    const peerClient = peerClientWith(sendBundleFetch);

    render(<Harness client={client} peerClient={peerClient} />);

    expect(screen.queryByTestId("dashboard-widgets")).toBeNull();
    expect(screen.getByText(/Loading station widgets/i)).not.toBeNull();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    expect(screen.queryByTestId("dashboard-widgets")).toBeNull();
    expect(
      screen.getByText(/Waiting for the main screen's Uplink list/),
    ).not.toBeNull();

    await act(async () => peerClient.announce([]));
    await screen.findByTestId("dashboard-widgets");
    expect(sendBundleFetch).not.toHaveBeenCalled();
    // The empty set opens the dashboard at once; the first load still ends after the roster wait.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 60));
    });
  });

  it("runs the loader exactly once under a StrictMode double-invoke", async () => {
    stubFetch(registryWith(goodHash));
    const stub = new StubTransport();
    const client = new TelemetryClient(stub);
    const sendBundleFetch = vi.fn(async () => BUNDLE_BYTES);
    const peerClient = peerClientWith(sendBundleFetch, ALPHA_RUNS);

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
    // doubled loader run would produce two. That is what this test is for.
    expect(sendBundleFetch).toHaveBeenCalledTimes(1);

    expect(getUplinkOutcomes().find((o) => o.id === "alpha")?.status).toBe(
      "loaded",
    );
  });

  it("reloads when the main screen stops running an Uplink this station loaded", async () => {
    stubFetch(registryWith(goodHash));
    const stub = new StubTransport();
    const client = new TelemetryClient(stub);
    const peerClient = peerClientWith(
      vi.fn(async () => BUNDLE_BYTES),
      ALPHA_RUNS,
    );
    const reload = vi.fn();
    stub.emit("system.uplinks", {
      uplinks: [
        { id: "alpha", version: "1.0.0", available: true, reason: null },
      ],
    });
    render(
      <TelemetryProvider client={client}>
        <PeerClientProvider client={peerClient}>
          <StationUplinkLoader
            rosterTimeoutMs={200}
            reload={reload}
            importBundle={async () => ({})}
          >
            <div data-testid="dashboard-widgets">widgets rendered</div>
          </StationUplinkLoader>
        </PeerClientProvider>
      </TelemetryProvider>,
    );
    await screen.findByTestId("dashboard-widgets");
    await waitFor(() =>
      expect(getUplinkOutcomes().find((o) => o.id === "alpha")).toBeDefined(),
    );

    await act(async () => {
      peerClient.announce([]);
    });
    await waitFor(() => expect(reload).toHaveBeenCalledOnce());
  });

  it("stays gated (never renders children) while telemetryClient/peerClient aren't both available yet", () => {
    // No PeerClientProvider at all: usePeerClient() resolves null, so the effect must wait rather than starting the load with a missing conduit.
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

describe("a station loads a third-party client whose dev path is on the main screen's network", () => {
  const DEV_BUNDLE = "http://builder.example.test:8099/third.client.js";
  const DEV_MANIFEST = "http://builder.example.test:8099/gonogo-uplink.json";

  function manifestWith(integrity: string) {
    return {
      id: "third",
      version: "1.0.0",
      minAppVersion: "0.0.0",
      apiVersion: hostCompat.apiVersion,
      contractMajor: hostCompat.contractMajor,
      contractMinor: hostCompat.contractMinor,
      integrity,
    };
  }

  function rosterFor(hash: string) {
    return {
      uplinks: [
        {
          id: "third",
          version: "1.0.0",
          available: true,
          reason: null,
          expectedClientHash: hash,
          clientSource: { url: "", devPath: DEV_BUNDLE },
        },
      ],
    };
  }

  const RUNS = [{ id: "third", version: "1.0.0" }];

  it("takes the manifest and the bundle through the main screen and never fetches either itself", async () => {
    const direct = stubFetch({ uplinks: [] });
    const stub = new StubTransport();
    const client = new TelemetryClient(stub);
    const sendBundleFetch = vi.fn(async () => BUNDLE_BYTES);
    const sendManifestFetch = vi.fn(async () => manifestWith(goodHash));

    const pending = runStationUplinkLoad(
      client,
      { sendBundleFetch, sendManifestFetch },
      RUNS,
      1000,
      async () => ({}),
    );
    stub.emit("system.uplinks", rosterFor(goodHash));

    const [third] = await pending;
    expect(third.status).toBe("loaded");
    expect(sendManifestFetch).toHaveBeenCalledWith(DEV_MANIFEST);
    expect(sendBundleFetch).toHaveBeenCalledWith(
      DEV_BUNDLE,
      goodHash,
      expect.anything(),
    );
    expect(direct).toEqual([]);
  });

  it("quarantines with the main screen's reason when the manifest cannot be fetched", async () => {
    stubFetch({ uplinks: [] });
    const stub = new StubTransport();
    const client = new TelemetryClient(stub);
    const sendBundleFetch = vi.fn(async () => BUNDLE_BYTES);
    const sendManifestFetch = vi.fn(async () => {
      throw new Error("manifest fetch failed: Failed to fetch");
    });

    const pending = runStationUplinkLoad(
      client,
      { sendBundleFetch, sendManifestFetch },
      RUNS,
      1000,
      async () => ({}),
    );
    stub.emit("system.uplinks", rosterFor(goodHash));

    const [third] = await pending;
    expect(third.status).toBe("quarantined");
    expect(third.reason).toMatch(
      /manifest fetch\/parse failed.*Failed to fetch/,
    );
    expect(sendBundleFetch).not.toHaveBeenCalled();
  });

  it("refuses a manifest whose integrity is not the one the mod vouched for", async () => {
    stubFetch({ uplinks: [] });
    const stub = new StubTransport();
    const client = new TelemetryClient(stub);
    const sendBundleFetch = vi.fn(async () => BUNDLE_BYTES);
    const sendManifestFetch = vi.fn(async () =>
      manifestWith("sha256-something-else"),
    );

    const pending = runStationUplinkLoad(
      client,
      { sendBundleFetch, sendManifestFetch },
      RUNS,
      1000,
      async () => ({}),
    );
    stub.emit("system.uplinks", rosterFor(goodHash));

    const [third] = await pending;
    expect(third.status).toBe("quarantined");
    expect(third.reason).toMatch(/manifest-declared integrity/);
    expect(sendBundleFetch).not.toHaveBeenCalled();
  });

  it("loads it when the game's Uplink list arrives after the first read gave up", async () => {
    stubFetch({ uplinks: [] });
    const stub = new StubTransport();
    const client = new TelemetryClient(stub);
    const conduit = {
      sendBundleFetch: vi.fn(async () => BUNDLE_BYTES),
      sendManifestFetch: vi.fn(async () => manifestWith(goodHash)),
    };

    const [missed] = await runStationUplinkLoad(
      client,
      conduit,
      RUNS,
      10,
      async () => ({}),
    );
    expect(missed.status).toBe("quarantined");
    expect(missed.awaitingRoster).toBe(true);

    const roster = decodeRosterPayload(rosterFor(goodHash));
    if (!roster) throw new Error("the fixture roster did not decode");
    const [third] = await loadWithArrivedRoster(
      roster,
      conduit,
      RUNS,
      async () => ({}),
    );
    expect(third.status).toBe("loaded");
    expect(conduit.sendBundleFetch).toHaveBeenCalledWith(
      DEV_BUNDLE,
      goodHash,
      expect.anything(),
    );
  });
});

describe("a station opens only once every Uplink its main screen runs has loaded", () => {
  const ALPHA_AND_BETA = [
    { id: "alpha", version: "1.0.0" },
    { id: "beta", version: "1.0.0" },
  ];
  const ROSTER = {
    uplinks: ["alpha", "beta"].map((id) => ({
      id,
      version: "1.0.0",
      available: true,
      reason: null,
    })),
  };

  function renderStation(
    peerClient: PeerClient,
    client: TelemetryClient,
    rosterTimeoutMs = 50,
  ) {
    return render(
      <TelemetryProvider client={client}>
        <PeerClientProvider client={peerClient}>
          <StationUplinkLoader
            rosterTimeoutMs={rosterTimeoutMs}
            importBundle={async () => ({})}
          >
            <div data-testid="dashboard-widgets">widgets rendered</div>
          </StationUplinkLoader>
        </PeerClientProvider>
      </TelemetryProvider>,
    );
  }

  function held(): { promise: Promise<void>; release: () => void } {
    let release = () => {};
    const promise = new Promise<void>((resolve) => {
      release = resolve;
    });
    return { promise, release };
  }

  function row(name: string): HTMLElement {
    const item = screen
      .getAllByRole("listitem")
      .find((li) => li.getAttribute("data-uplink-id") === name);
    if (!item) throw new Error(`no row for ${name}`);
    return item;
  }

  it("fills an Uplink's bar as its bytes arrive from the main screen", async () => {
    stubFetch(registryWith(goodHash));
    const stub = new StubTransport();
    const client = new TelemetryClient(stub);
    stub.emit("system.uplinks", ROSTER);
    const gate = held();
    let report: (received: number, total: number) => void = () => {};
    const sendBundleFetch: PeerClient["sendBundleFetch"] = vi.fn(
      async (_url, _hash, options) => {
        report = options?.onProgress ?? report;
        await gate.promise;
        return BUNDLE_BYTES;
      },
    );
    renderStation(peerClientWith(sendBundleFetch, ALPHA_RUNS), client);

    const bar = await within(row("alpha")).findByRole("progressbar", {
      name: "alpha progress",
    });
    expect(bar.getAttribute("aria-valuenow")).toBeNull();
    await waitFor(() => expect(sendBundleFetch).toHaveBeenCalled());

    act(() => report(0, 1_900_000));
    act(() => report(1_200_000, 1_900_000));
    expect(
      within(row("alpha"))
        .getByRole("progressbar", { name: "alpha progress" })
        .getAttribute("aria-valuenow"),
    ).toBe("63");
    expect(row("alpha").textContent).toMatch(/1\.2 of 1\.9\sMB/);

    await act(async () => gate.release());
    await screen.findByTestId("dashboard-widgets");
  });

  it("shows no dashboard while an Uplink of the set is still downloading", async () => {
    stubFetch(registryWith(goodHash));
    const stub = new StubTransport();
    const client = new TelemetryClient(stub);
    stub.emit("system.uplinks", ROSTER);
    const gate = held();
    const sendBundleFetch = vi.fn(async () => {
      await gate.promise;
      return BUNDLE_BYTES;
    });
    renderStation(peerClientWith(sendBundleFetch, ALPHA_RUNS), client);

    await waitFor(() =>
      expect(row("alpha").textContent).toMatch(/Downloading/),
    );
    expect(screen.queryByTestId("dashboard-widgets")).toBeNull();

    await act(async () => gate.release());
    await screen.findByTestId("dashboard-widgets");
  });

  it("keeps the dashboard closed while one Uplink is loaded and another is not, then opens it", async () => {
    stubFetch(registryWith(goodHash));
    const stub = new StubTransport();
    const client = new TelemetryClient(stub);
    stub.emit("system.uplinks", ROSTER);
    const gate = held();
    const sendBundleFetch = vi
      .fn(async () => BUNDLE_BYTES)
      .mockImplementationOnce(async () => BUNDLE_BYTES)
      .mockImplementationOnce(async () => {
        await gate.promise;
        return BUNDLE_BYTES;
      });
    renderStation(peerClientWith(sendBundleFetch, ALPHA_AND_BETA), client);

    await waitFor(() => expect(row("alpha").textContent).toMatch(/Loaded/));
    await waitFor(() => expect(row("beta").textContent).toMatch(/Downloading/));
    expect(screen.queryByTestId("dashboard-widgets")).toBeNull();

    await act(async () => gate.release());
    await screen.findByTestId("dashboard-widgets");
    expect(screen.queryByRole("listitem")).toBeNull();
  });

  it("never falls through to the dashboard when an Uplink fails, and loads it on Retry", async () => {
    stubFetch(registryWith(goodHash));
    const stub = new StubTransport();
    const client = new TelemetryClient(stub);
    stub.emit("system.uplinks", ROSTER);
    const sendBundleFetch = vi
      .fn(async () => BUNDLE_BYTES)
      .mockImplementationOnce(async () => {
        throw new Error("the main screen could not reach the bundle");
      });
    renderStation(peerClientWith(sendBundleFetch, ALPHA_RUNS), client);

    await waitFor(() =>
      expect(row("alpha").textContent).toMatch(
        /Failed.*the main screen could not reach the bundle/,
      ),
    );
    // Long past the roster deadline: a failure never opens the dashboard.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 100));
    });
    expect(screen.queryByTestId("dashboard-widgets")).toBeNull();

    await act(async () => {
      screen.getByRole("button", { name: /Retry alpha/ }).click();
    });
    await screen.findByTestId("dashboard-widgets");
    expect(sendBundleFetch).toHaveBeenCalledTimes(2);
  });

  it("keeps the block up with a Retry while the game's Uplink list has not named an Uplink", async () => {
    stubFetch({ uplinks: [] });
    const stub = new StubTransport();
    const client = new TelemetryClient(stub);
    renderStation(
      peerClientWith(
        vi.fn(async () => BUNDLE_BYTES),
        [{ id: "third", version: "1.0.0" }],
      ),
      client,
      10,
    );

    await waitFor(() =>
      expect(row("third").textContent).toMatch(
        /Waiting for the game's Uplink list/,
      ),
    );
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    expect(screen.queryByTestId("dashboard-widgets")).toBeNull();
    expect(screen.getByRole("button", { name: /Retry third/ })).not.toBeNull();
  });

  it("closes the dashboard again when the main screen starts running one more Uplink", async () => {
    stubFetch(registryWith(goodHash));
    const stub = new StubTransport();
    const client = new TelemetryClient(stub);
    stub.emit("system.uplinks", ROSTER);
    const gate = held();
    const sendBundleFetch = vi
      .fn(async () => BUNDLE_BYTES)
      .mockImplementationOnce(async () => BUNDLE_BYTES)
      .mockImplementationOnce(async () => {
        await gate.promise;
        return BUNDLE_BYTES;
      });
    const peerClient = peerClientWith(sendBundleFetch, ALPHA_RUNS);
    renderStation(peerClient, client);
    await screen.findByTestId("dashboard-widgets");

    await act(async () => peerClient.announce(ALPHA_AND_BETA));
    await waitFor(() => expect(row("beta").textContent).toMatch(/Downloading/));
    expect(screen.queryByTestId("dashboard-widgets")).toBeNull();

    await act(async () => gate.release());
    await screen.findByTestId("dashboard-widgets");
  });
});
