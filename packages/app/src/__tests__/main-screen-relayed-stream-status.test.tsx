import { clearRegistry, ErrorBoundary } from "@ksp-gonogo/core";
import { act, render, StubTransport } from "@ksp-gonogo/sitrep-sdk/testing";
import { ModalProvider } from "@ksp-gonogo/ui";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ANALYTICS_CONSENT_KEY } from "../analytics/AnalyticsConsentService";
import { MainScreen } from "../screens/MainScreen";
import {
  getSitrepTransportStatus,
  resetSitrepRuntimeForTests,
} from "../telemetry/sitrepRuntime";

const sockets: string[] = [];

class RecordingSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  readyState = 0;
  binaryType = "blob";
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: (() => void) | null = null;
  constructor(url: string) {
    sockets.push(url);
  }
  send() {}
  close() {}
  addEventListener() {}
  removeEventListener() {}
}

function mount(transport?: StubTransport) {
  return render(
    <ErrorBoundary>
      <ModalProvider>
        <MainScreen screen="pilot" transport={transport} />
      </ModalProvider>
    </ErrorBoundary>,
  );
}

describe("MainScreen: the Telemetry stream row of a screen fed through a peer link", () => {
  beforeEach(() => {
    clearRegistry();
    resetSitrepRuntimeForTests();
    sockets.length = 0;
    localStorage.clear();
    localStorage.setItem(ANALYTICS_CONSENT_KEY, "disabled");
    vi.stubGlobal("WebSocket", RecordingSocket);
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
  });

  it("reports the link's state and opens no socket to the game", async () => {
    const { unmount } = mount(new StubTransport());
    await act(async () => {});
    expect(getSitrepTransportStatus()).toBe("connected");
    expect(sockets).toEqual([]);
    unmount();
  });

  it("still builds its own socket to the game when no transport is given", async () => {
    const { unmount } = mount();
    await act(async () => {});
    expect(sockets.length).toBeGreaterThan(0);
    unmount();
  });
});
