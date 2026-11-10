import { clearRegistry, ErrorBoundary } from "@ksp-gonogo/core";
import {
  clearRootProviders,
  registerRootProvider,
} from "@ksp-gonogo/sitrep-sdk";
import { act, render, StubTransport } from "@ksp-gonogo/sitrep-sdk/testing";
import { waitFor } from "@ksp-gonogo/test-utils";
import { ModalProvider } from "@ksp-gonogo/ui";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ANALYTICS_CONSENT_KEY } from "../analytics/AnalyticsConsentService";
import { type PeerClient, PeerClientProvider } from "../peer/PeerClientContext";
import { MainScreen } from "../screens/MainScreen";
import { resetSitrepRuntimeForTests } from "../telemetry/sitrepRuntime";
import { idlePeerClient } from "../test/peerFakes";
import { setConsentPrompt } from "../uplinks/consent";
import { hostCompat } from "../uplinks/hostCompat";
import {
  __resetUplinkOutcomes,
  getUplinkOutcomes,
  type RunningUplink,
} from "../uplinks/loaderState";

const BUNDLE_SRC = "export const marker = 'pilot-loaded';";
const BUNDLE_BYTES = new TextEncoder().encode(BUNDLE_SRC).buffer as ArrayBuffer;
const BUNDLE_URL = `data:text/javascript,${encodeURIComponent(BUNDLE_SRC)}`;
const RUNS: RunningUplink[] = [{ id: "alpha", version: "1.0.0" }];

async function integrityOf(bytes: ArrayBuffer): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  const hex = Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return `sha256-${hex}`;
}

function stubRegistry(integrity: string): void {
  const index = {
    uplinks: [
      {
        id: "alpha",
        name: "alpha",
        author: "test-fixture",
        repo: "",
        versions: [
          {
            version: "1.0.0",
            minAppVersion: "0.0.0",
            apiVersion: hostCompat.apiVersion,
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
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (String(url).includes("registry.local.json")) {
        return Response.json(index);
      }
      throw new Error(`a pilot must not fetch a bundle itself: ${url}`);
    }),
  );
}

function hostedPeerClient(
  sendBundleFetch: PeerClient["sendBundleFetch"],
): PeerClient {
  return {
    ...idlePeerClient(),
    sendBundleFetch,
    onHostUplinksChange: (cb) => {
      cb(RUNS);
      return () => {};
    },
  };
}

describe("MainScreen: a pilot that joined through a host", () => {
  beforeEach(async () => {
    clearRegistry();
    __resetUplinkOutcomes();
    resetSitrepRuntimeForTests();
    localStorage.clear();
    localStorage.setItem(ANALYTICS_CONSENT_KEY, "disabled");
    setConsentPrompt(async () => true);
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    setConsentPrompt(async () => false);
    clearRootProviders();
    window.history.replaceState(null, "", "/");
  });

  async function mountPilot(
    sendBundleFetch: PeerClient["sendBundleFetch"] = vi.fn(
      async () => BUNDLE_BYTES,
    ),
  ) {
    window.history.replaceState(null, "", "/join?ABC234");
    stubRegistry(await integrityOf(BUNDLE_BYTES));
    const transport = new StubTransport();
    const view = render(
      <ErrorBoundary>
        <ModalProvider>
          <PeerClientProvider client={hostedPeerClient(sendBundleFetch)}>
            <MainScreen screen="pilot" transport={transport} hosting={false} />
          </PeerClientProvider>
        </ModalProvider>
      </ErrorBoundary>,
    );
    await act(async () => {
      transport.emit("system.uplinks", {
        uplinks: [
          { id: "alpha", version: "1.0.0", available: true, reason: null },
        ],
      });
    });
    return { view, sendBundleFetch };
  }

  it("takes the Uplinks the host runs through the host, never fetching a bundle itself", async () => {
    const { view, sendBundleFetch } = await mountPilot();

    await waitFor(() => expect(sendBundleFetch).toHaveBeenCalledTimes(1));
    expect(getUplinkOutcomes().map((o) => o.id)).toEqual(["alpha"]);
    await waitFor(() =>
      expect(getUplinkOutcomes()[0]?.status).not.toBe("loading"),
    );
    view.unmount();
  });

  it("loads once when an Uplink's client registers a root provider, keeping the dashboard up", async () => {
    /*
     * Each fetch stands in for one import of the client: a re-executed module
     * registers a provider of a new identity, which is what makes
     * `RootProviders` remount everything below it.
     */
    const sendBundleFetch = vi.fn(async () => {
      registerRootProvider({
        id: "alpha.root",
        Provider: ({ children }: { children: ReactNode }) => <>{children}</>,
      });
      return BUNDLE_BYTES;
    });
    const { view } = await mountPilot(sendBundleFetch);

    await waitFor(() => expect(sendBundleFetch).toHaveBeenCalledTimes(1));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 200));
    });
    expect(sendBundleFetch).toHaveBeenCalledTimes(1);
    view.unmount();
  });
});
