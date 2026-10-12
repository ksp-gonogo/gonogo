import { clearRegistry, ErrorBoundary } from "@ksp-gonogo/core";
import { act, render } from "@ksp-gonogo/sitrep-sdk/testing";
import { ModalProvider } from "@ksp-gonogo/ui";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ANALYTICS_CONSENT_KEY } from "../analytics/AnalyticsConsentService";
import { peerHostService } from "../peer/PeerHostService";
import { MainScreen } from "../screens/MainScreen";

describe("MainScreen host services", () => {
  beforeEach(() => {
    clearRegistry();
    localStorage.clear();
    localStorage.setItem(ANALYTICS_CONSENT_KEY, "disabled");
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
    vi.restoreAllMocks();
  });

  it("builds one GO/NO-GO host under StrictMode, so one countdown can stage", async () => {
    const votes = vi.spyOn(peerHostService, "onGonogoVote");
    const { unmount } = render(
      <StrictMode>
        <ErrorBoundary>
          <ModalProvider>
            <MainScreen />
          </ModalProvider>
        </ErrorBoundary>
      </StrictMode>,
    );
    expect(votes).toHaveBeenCalledTimes(1);
    unmount();
    await act(async () => {});
  });
});
