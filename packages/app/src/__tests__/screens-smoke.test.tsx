/**
 * Smoke-level render tests for the two top-level screens.
 *
 * These aren't about asserting specific telemetry or flows — they're a
 * tripwire for provider-order mistakes and any regressions that take
 * either screen completely dark on mount. The bug that motivated this
 * file: `ModalProvider` at the app root sits above `SerialDeviceProvider`,
 * and a previous dashboard-tabbed-config test inverted that ordering in
 * its harness, hiding a crash in the real app. A screen-level smoke with
 * the real provider tree catches that class of mistake.
 */

import { clearRegistry, ErrorBoundary } from "@ksp-gonogo/core";
import "@ksp-gonogo/components"; // self-register the built-in components
import { render, screen } from "@ksp-gonogo/test-utils";
import { ModalProvider } from "@ksp-gonogo/ui";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MainScreen } from "../screens/MainScreen";
import { StationScreen } from "../screens/StationScreen";

/** Mirror the real provider tree from `main.tsx` — ErrorBoundary above, ModalProvider at root. */
function renderScreen(screenNode: React.ReactNode) {
  return render(
    <ErrorBoundary>
      <ModalProvider>{screenNode}</ModalProvider>
    </ErrorBoundary>,
  );
}

describe("MainScreen smoke", () => {
  beforeEach(() => {
    clearRegistry();
    localStorage.clear();
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

  it("mounts without throwing", () => {
    // Default MainScreen demo config references widgets (current-orbit,
    // map-view, etc.) — they all need to render without their data being
    // available, and none of them should throw when their provider context
    // is present but telemetry is absent.
    expect(() => renderScreen(<MainScreen />)).not.toThrow();
  });

  it("renders with the dashboard visible (widget area mounted)", () => {
    const { container } = renderScreen(<MainScreen />);
    // Any styled container at the layout root — we're not asserting widget
    // internals, just that the screen rendered past error boundary.
    expect(container.querySelector("div")).not.toBeNull();
  });

  it("renders the mission banner above the dashboard", () => {
    // Lightweight wiring check only — MissionBanner's own behaviour (live
    // UT updates, field content) is covered in
    // `components/MissionBanner.test.tsx` against a real stream fixture.
    // Full MainScreen has no telemetry stream mounted here, so the time
    // field reads its "no sample yet" placeholder.
    renderScreen(<MainScreen />);
    expect(
      screen.getByRole("group", { name: "Mission status" }),
    ).not.toBeNull();
    expect(screen.getByText("KSC")).not.toBeNull();
  });
});

describe("StationScreen smoke", () => {
  beforeEach(() => {
    clearRegistry();
    localStorage.clear();
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

  it("mounts without throwing and shows the connect prompt", () => {
    // With no saved host in localStorage and no connection, StationScreen
    // shows the "Connect to Mission Control" prompt rather than the dashboard.
    expect(() => renderScreen(<StationScreen />)).not.toThrow();
    expect(screen.getByText(/Connect to Mission Control/i)).not.toBeNull();
  });

  it("does not attempt auto-connect when localStorage is empty", () => {
    renderScreen(<StationScreen />);
    // The connect button's disabled attribute reflects the live connection
    // state — idle means the screen isn't mid-reconnect on mount.
    const connectButton = screen.getByRole("button", { name: /connect/i });
    expect(connectButton.getAttribute("disabled")).toBeNull();
  });

  it("consumes ?host=<id> from the URL, persists it, and strips the param", () => {
    // Land on /station?host=ABC123 — the QR-code path. The screen
    // should pre-fill the input from the URL, drop the param, and (for
    // the next load) treat localStorage as authoritative.
    globalThis.history.replaceState({}, "", "/station?host=ABC123");
    renderScreen(<StationScreen />);

    expect(localStorage.getItem("gonogo-station-host-id")).toBe("ABC123");
    expect(globalThis.location.search).toBe("");

    // Reset for subsequent tests in this file.
    globalThis.history.replaceState({}, "", "/");
  });
});
