/**
 * Smoke-level render tests for the two top-level screens.
 *
 * These aren't about asserting specific telemetry or flows, they're a
 * tripwire for provider-order mistakes and any regressions that take
 * either screen completely dark on mount. The bug that motivated this
 * file: `ModalProvider` at the app root sits above `SerialDeviceProvider`,
 * and a previous dashboard-tabbed-config test inverted that ordering in
 * its harness, hiding a crash in the real app. A screen-level smoke with
 * the real provider tree catches that class of mistake.
 */

import { clearRegistry, ErrorBoundary } from "@ksp-gonogo/core";
import "@ksp-gonogo/components"; // self-register the built-in components
import { StubTransport } from "@ksp-gonogo/sitrep-sdk/testing";
import { act, render, screen, waitFor } from "@ksp-gonogo/test-utils";
import { ModalProvider } from "@ksp-gonogo/ui";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ANALYTICS_CONSENT_KEY } from "../analytics/AnalyticsConsentService";
import { MainScreen } from "../screens/MainScreen";
import { StationScreen } from "../screens/StationScreen";

/**
 * Mirror the real provider tree from `main.tsx`: ErrorBoundary above ModalProvider at root.
 *
 * Each test unmounts the screen at the end of its own body. A mounted screen
 * keeps updating on its own clocks (alarm strips, stream status), and one of
 * those updates landing between the body and the automatic cleanup is outside
 * `act`.
 */
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
    let view: ReturnType<typeof renderScreen> | undefined;
    expect(() => {
      view = renderScreen(<MainScreen />);
    }).not.toThrow();
    view?.unmount();
  });

  it("renders with the dashboard visible (widget area mounted)", () => {
    const { container, unmount } = renderScreen(<MainScreen />);
    // Any styled container at the layout root, we're not asserting widget internals, just that the screen rendered past error boundary.
    expect(container.querySelector("div")).not.toBeNull();
    unmount();
  });

  it("shows the empty-dashboard notice on a first run, with a button that adds a widget", () => {
    const { unmount } = renderScreen(<MainScreen />);
    expect(screen.getByText("No widgets on this dashboard")).not.toBeNull();
    expect(screen.getByRole("button", { name: "Add a widget" })).not.toBeNull();
    expect(screen.getByRole("button", { name: "Add widget" })).not.toBeNull();
    unmount();
  });

  it("renders the mission banner above the dashboard", () => {
    // Lightweight wiring check only: MissionBanner's own behaviour (live
    // UT updates, field content) is covered in
    // `components/MissionBanner.test.tsx` against a real stream fixture.
    // Full MainScreen has no telemetry stream mounted here, so the time
    // field reads its "no sample yet" placeholder and the vantage control
    // names no centre, since nothing was chosen and no frame has said where.
    const { unmount } = renderScreen(<MainScreen />);
    expect(
      screen.getByRole("group", { name: "Mission status" }),
    ).not.toBeNull();
    expect(
      screen.getByRole("button", { name: "Command centre vantage: Unknown" }),
    ).not.toBeNull();
    unmount();
  });

  it("gives the pilot seat a vantage readout, never the picker", () => {
    // `PilotVantage` pins that seat to the craft, so the lever would fight its
    // own binding. Asserted through the whole provider tower rather than on
    // `VantageControl` alone, because what decides it is the `screen` prop
    // this file is the only test to thread all the way down.
    const { unmount } = renderScreen(<MainScreen screen="pilot" />);

    expect(
      screen.queryByRole("button", { name: /^Command centre vantage:/ }),
    ).toBeNull();
    expect(
      screen.getAllByRole("status").map((region) => region.textContent),
    ).toContain("Command centre vantage: No vantage yet");
    unmount();
  });

  it("keeps each scene's old layout: a stored scene slot switches in when the game enters that scene", async () => {
    localStorage.setItem(
      "gonogo:dashboard:main",
      JSON.stringify({
        items: [{ i: "orbit", componentId: "orbit-view" }],
        layout: [{ i: "orbit", x: 0, y: 0, w: 4, h: 4 }],
      }),
    );
    localStorage.setItem(
      "gonogo:dashboard:main:SpaceCenter",
      JSON.stringify({
        items: [{ i: "warp", componentId: "warp-control" }],
        layout: [{ i: "warp", x: 0, y: 0, w: 4, h: 4 }],
      }),
    );
    const transport = new StubTransport();
    const { container, unmount } = renderScreen(
      <MainScreen transport={transport} />,
    );
    expect(container.querySelector('[data-i="orbit"]')).not.toBeNull();
    expect(container.querySelector('[data-i="warp"]')).toBeNull();

    await waitFor(() =>
      expect(transport.isSubscribed("spaceCenter.scene")).toBe(true),
    );
    await act(async () => {
      transport.emit("spaceCenter.scene", { scene: "Flight" });
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 100));
    });
    await act(async () => {
      transport.emit("spaceCenter.scene", { scene: "SpaceCenter" });
    });

    await waitFor(() =>
      expect(container.querySelector('[data-i="warp"]')).not.toBeNull(),
    );
    expect(container.querySelector('[data-i="orbit"]')).toBeNull();
    unmount();
  });

  it("goes straight to first-run setup with no analytics ask", async () => {
    const { unmount } = renderScreen(<MainScreen />);

    const dialog = await screen.findByRole("dialog");
    expect(dialog).not.toHaveAccessibleName(/improve gonogo/i);
    expect(document.querySelectorAll('[aria-modal="true"]')).toHaveLength(1);
    expect(localStorage.getItem(ANALYTICS_CONSENT_KEY)).toBeNull();
    unmount();
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

  it("mounts with its code and shows that it is reaching the host", async () => {
    /*
     * jsdom has no WebRTC, so the real peerjs Peer aborts and the station drops
     * into its retry loop. Before it has ever connected that is still reaching
     * the host, not a failure.
     */
    const { unmount } = renderScreen(<StationScreen code="ABC123" />);
    expect(await screen.findByText("Reaching the host")).toBeInTheDocument();
    expect(screen.getByText("ABC123")).toBeInTheDocument();
    unmount();
  });
});
