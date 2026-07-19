/**
 * Tests for the `CameraFeed` component.
 *
 * Two halves:
 *  - the "SIGNAL LOST" overlay + zoom / pan / resize / CommNet feedback
 *    controls (carried over from the original kerbcast smoke);
 *  - the camera-selection layer (picker, Next/Previous buttons, the
 *    `nextCamera` / `prevCamera` serial-input actions, status indicator
 *    and empty state) that mirrors the OCISLY `CameraFeed`.
 *
 * Everything drives the real `KerbcastDataSource` + real `useKerbcastCameras`
 * / `useKerbcastStream` hooks through the SDK's canonical `MockSidecar`
 * (`@ksp-gonogo/kerbcast/testing`) — the protocol-level fake that owns a camera
 * registry and speaks the full kerbcast wire protocol. The only thing faked is
 * the WebRTC transport, because jsdom can't produce a real `MediaStream`.
 * Multi-camera scenarios are expressed by populating the sidecar's registry
 * (`addCamera` / `setCameras`); state changes go through `updateCamera` /
 * `destroyCamera`; client commands are inspected via the parsed `commands`
 * array.
 */

import {
  clearActionHandlers,
  clearAugments,
  clearRegistry,
  clearUplinkHandles,
  DashboardItemContext,
  dispatchAction,
  getAugmentsForSlot,
} from "@ksp-gonogo/core";
import type { CameraLifecycle, Layer } from "@ksp-gonogo/kerbcast";
import { type MockCameraInit, MockSidecar } from "@ksp-gonogo/kerbcast/testing";
import type {
  ComponentProps,
  DataSource,
  DataSourceStatus,
} from "@ksp-gonogo/sitrep-sdk";
import {
  registerAugment,
  registerDataSource,
  registerUplinkHandle,
} from "@ksp-gonogo/sitrep-sdk";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@ksp-gonogo/test-utils";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { KerbcastDataSource } from "../KerbcastDataSource";
import {
  type CameraBadgesContext,
  CameraFeed,
  type CameraFeedConfig,
  type CameraOverlayContext,
} from "./CameraFeed";
import { CameraFeedConfigPanel } from "./CameraFeedConfigPanel";

// ---------------------------------------------------------------------------
// Render helper — CameraFeed calls useActionInput, which reads its instance
// ID from the enclosing DashboardItemContext. Rendering the component bare
// throws ("must be used inside a DashboardItemContext.Provider"), so every
// test goes through this wrapper. Mirrors CameraFeed/index.test.tsx's
// renderFeed(). The instanceId is also what dispatchAction() targets when a
// test drives the serial-input path directly.
// ---------------------------------------------------------------------------

const TEST_INSTANCE_ID = "camera-feed-test";

// Sources created during a test are torn down in afterEach AFTER the widget is
// unmounted, so the CameraFeed is already gone when disconnect() fires.
// Disconnecting a live source while the widget is still mounted triggers
// useKerbcastStream state updates outside act() — the documented anti-pattern in
// CLAUDE.md.
const createdSources: Array<{ disconnect: () => void }> = [];

// Rendered trees, tracked so afterEach can unmount them BEFORE disconnecting
// sources. RTL's auto-cleanup runs after this file's afterEach, so it can't be
// relied on to unmount first — the render helpers below push their unmount here.
const renderedTrees: Array<() => void> = [];

// Fill the config defaults so individual tests only spell out the fields they
// care about (flightId, and occasionally showDebugInfo).
function fullConfig(config: Partial<CameraFeedConfig>): CameraFeedConfig {
  return { flightId: null, showDebugInfo: false, ...config };
}

function renderFeed(
  config: Partial<CameraFeedConfig>,
  onConfigChange?: ComponentProps<CameraFeedConfig>["onConfigChange"],
): ReturnType<typeof render> {
  const result = render(
    <DashboardItemContext.Provider value={{ instanceId: TEST_INSTANCE_ID }}>
      <CameraFeed
        config={fullConfig(config)}
        id={TEST_INSTANCE_ID}
        onConfigChange={onConfigChange}
      />
    </DashboardItemContext.Provider>,
  );
  renderedTrees.push(result.unmount);
  return result;
}

// A stateful wrapper that holds `config` in React state and feeds its own
// setter back as `onConfigChange`. Lets selection tests assert the *real*
// round-trip — pick a camera (picker, Next/Prev button, or a dispatched
// serial action) → onConfigChange persists flightId → the widget re-renders
// against the new selection — rather than just spying on the callback.
function renderStatefulFeed(
  initial: Partial<CameraFeedConfig>,
): ReturnType<typeof render> {
  function Harness() {
    const [config, setConfig] = useState<CameraFeedConfig>(fullConfig(initial));
    return (
      <DashboardItemContext.Provider value={{ instanceId: TEST_INSTANCE_ID }}>
        <CameraFeed
          config={config}
          id={TEST_INSTANCE_ID}
          onConfigChange={(next) => setConfig(next as CameraFeedConfig)}
        />
      </DashboardItemContext.Provider>
    );
  }
  const result = render(<Harness />);
  renderedTrees.push(result.unmount);
  return result;
}

// Note: importing KerbcastDataSource class directly (not the barrel index)
// avoids the module-level registerDataSource() side effect. Tests register
// their own instance explicitly via registerDataSource() in each fixture.

// ---------------------------------------------------------------------------
// Camera-state fixture factory — the sidecar's CameraState has ~25 fields;
// most tests only care about a handful, so this fills the rest with sane
// "active, no-zoom, no-pan" defaults and lets callers override.
// ---------------------------------------------------------------------------

type CameraStateLike = Record<string, unknown> & { flightId: number };

function makeCamera(overrides: CameraStateLike): CameraStateLike {
  return {
    lifecycle: "active",
    partName: "mumech.MuMechModuleHullCamera",
    partTitle: "Hullcam Mk1",
    cameraName: "Camera",
    vesselName: "Kerbal X",
    layers: ["NEAR", "SCALED"],
    operatorLayers: ["NEAR", "SCALED"],
    renderWidth: 384,
    renderHeight: 384,
    operatorWidth: 384,
    operatorHeight: 384,
    supportsZoom: false,
    fov: 60,
    fovMin: 10,
    fovMax: 90,
    supportsPan: false,
    panYaw: 0,
    panPitch: 0,
    panYawMin: 0,
    panYawMax: 0,
    panPitchMin: 0,
    panPitchMax: 0,
    encoderBitrateBps: 1_500_000,
    targetBitrateBps: 0,
    degradeLevel: 0,
    ...overrides,
  };
}

// Translate a loose `CameraStateLike` (string enum values, ~25 fields) into the
// SDK's `MockCameraInit`. Every field is mapped through — not a subset — so the
// resulting camera matches the old fixture exactly and `buildCamera`'s differing
// defaults (e.g. `supportsZoom: true`, `fov: 60`, `layers: [Near]`) never leak
// in. The enum-typed fields are cast (their runtime string values already match
// the enum members); the rest are plain number/string/boolean pass-through.
function toInit(c: CameraStateLike): MockCameraInit {
  return {
    flightId: c.flightId,
    lifecycle: c.lifecycle as CameraLifecycle | undefined,
    partName: c.partName as string | undefined,
    partTitle: c.partTitle as string | undefined,
    cameraName: c.cameraName as string | undefined,
    vesselName: c.vesselName as string | undefined,
    layers: c.layers as Layer[] | undefined,
    operatorLayers: c.operatorLayers as Layer[] | undefined,
    renderWidth: c.renderWidth as number | undefined,
    renderHeight: c.renderHeight as number | undefined,
    operatorWidth: c.operatorWidth as number | undefined,
    operatorHeight: c.operatorHeight as number | undefined,
    supportsZoom: c.supportsZoom as boolean | undefined,
    fov: c.fov as number | undefined,
    fovMin: c.fovMin as number | undefined,
    fovMax: c.fovMax as number | undefined,
    supportsPan: c.supportsPan as boolean | undefined,
    panYaw: c.panYaw as number | undefined,
    panPitch: c.panPitch as number | undefined,
    panYawMin: c.panYawMin as number | undefined,
    panYawMax: c.panYawMax as number | undefined,
    panPitchMin: c.panPitchMin as number | undefined,
    panPitchMax: c.panPitchMax as number | undefined,
    encoderBitrateBps: c.encoderBitrateBps as number | undefined,
    targetBitrateBps: c.targetBitrateBps as number | undefined,
    degradeLevel: c.degradeLevel as number | undefined,
  };
}

// Build a URL-aware fetch impl for the connect handshake: GET `/ice-config`
// (TURN creds) → empty server list (no relay); the SDK client's POST `/offer`
// → an SDP answer carrying the given flightIds, so the client opens a track for
// every camera it's about to learn about. `makeOfferResponse` is called per
// invocation because a `Response` body is single-use.
function kerbcastFetch(
  cameras: number[],
): (input: RequestInfo | URL) => Promise<Response> {
  return async (input) => {
    if (String(input).includes("/ice-config")) {
      return new Response(JSON.stringify({ iceServers: [] }), { status: 200 });
    }
    return MockSidecar.makeOfferResponse(cameras);
  };
}

// ---------------------------------------------------------------------------
// Global ResizeObserver stub — jsdom doesn't ship one. The resize-observer
// describe block installs a controllable version in its own beforeEach; all
// other tests just need a no-op stub so the component mounts without error.
// ---------------------------------------------------------------------------

if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}

// ---------------------------------------------------------------------------
// Test setup / teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.spyOn(globalThis, "fetch").mockImplementation(kerbcastFetch([42]));
});

afterEach(() => {
  // Unmount every rendered tree first so the widget is gone before disconnect()
  // fires (RTL auto-cleanup runs after this hook, too late for that ordering).
  for (const unmount of renderedTrees) unmount();
  renderedTrees.length = 0;
  // Disconnect tracked sources AFTER unmount so the widget is unmounted first.
  for (const ds of createdSources) ds.disconnect();
  createdSources.length = 0;
  clearActionHandlers(); // tests share one instanceId — handlers would leak
  clearRegistry(); // resets all registries — tests register their own instance
  clearUplinkHandles(); // resets the narrow uplink-handle registry too
  clearAugments(); // wipe any test augment so it never leaks into other suites
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Test fixture: builds and registers a KerbcastDataSource with a fake
// transport, connects it, opens the control channel, and pushes an initial
// camera snapshot. Defaults to a single active "Starboard Cam" (flightId 42)
// matching the original single-camera fixture; pass `cameras` for the
// multi-camera selection scenarios.
// ---------------------------------------------------------------------------

async function buildConnectedSource(
  cameras: CameraStateLike[] = [
    makeCamera({ flightId: 42, cameraName: "Starboard Cam" }),
  ],
): Promise<{ ds: KerbcastDataSource; sidecar: MockSidecar }> {
  const sidecar = new MockSidecar();
  for (const c of cameras) {
    sidecar.addCamera(toInit(c));
  }
  const ds = new KerbcastDataSource({ port: 1 }, sidecar.createTransport());

  registerUplinkHandle("kerbcast", ds);

  // Keep the /offer answer's `cameras` array in sync with the snapshot so the
  // client opens a track for every flightId it's about to learn about.
  vi.spyOn(globalThis, "fetch").mockImplementation(
    kerbcastFetch(cameras.map((c) => c.flightId)),
  );

  await act(async () => {
    await ds.connect();
  });

  // Complete the WebRTC handshake: open() fires the channel-open handler and
  // pushes hello + camera-snapshot (built from the cameras added above).
  await act(async () => {
    sidecar.open();
    sidecar.setConnectionState("connected");
  });

  createdSources.push(ds);
  return { ds, sidecar };
}

// ---------------------------------------------------------------------------
// Minimal in-memory DataSource for the "data" (CommNet) source stub
// ---------------------------------------------------------------------------

function makeDataSource(
  id: string,
  initialValues: Record<string, unknown> = {},
): DataSource & { emit: (key: string, value: unknown) => void } {
  const dataListeners = new Map<string, Set<(v: unknown) => void>>();
  const statusListeners = new Set<(s: DataSourceStatus) => void>();

  const source: DataSource & { emit: (key: string, value: unknown) => void } = {
    id,
    name: id,
    status: "connected" as DataSourceStatus,
    connect: async () => {},
    disconnect: () => {},
    schema: () => [],
    execute: async () => {},
    configSchema: () => [],
    configure: () => {},
    getConfig: () => ({}),
    subscribe(key, cb) {
      if (!dataListeners.has(key)) dataListeners.set(key, new Set());
      dataListeners.get(key)?.add(cb);
      // Deliver initial value synchronously if available
      if (key in initialValues) {
        queueMicrotask(() => cb(initialValues[key]));
      }
      return () => dataListeners.get(key)?.delete(cb);
    },
    onStatusChange(cb) {
      statusListeners.add(cb);
      return () => statusListeners.delete(cb);
    },
    emit(key, value) {
      dataListeners.get(key)?.forEach((cb) => {
        cb(value);
      });
    },
  };
  return source;
}

// ---------------------------------------------------------------------------
// Camera selection — picker, Next/Previous, serial actions, empty/status
// ---------------------------------------------------------------------------

describe("CameraFeed — camera selection", () => {
  const TWO_CAMERAS = [
    makeCamera({
      flightId: 42,
      cameraName: "Starboard Cam",
      vesselName: "Kerbal X",
    }),
    makeCamera({
      flightId: 43,
      cameraName: "Nose Cam",
      vesselName: "Kerbal X",
    }),
    makeCamera({
      flightId: 44,
      cameraName: "Tail Cam",
      vesselName: "Kerbal X",
    }),
  ];

  it("lists every available camera in the menu", async () => {
    await buildConnectedSource(TWO_CAMERAS);

    renderFeed({ flightId: null });

    // The title is the menu trigger; open it to reveal the camera list.
    fireEvent.click(screen.getByRole("button", { name: /starboard cam/i }));

    const labels = screen
      .getAllByRole("menuitemradio")
      .map((item) => item.textContent);
    expect(labels).toEqual([
      "Starboard Cam (Kerbal X)",
      "Nose Cam (Kerbal X)",
      "Tail Cam (Kerbal X)",
    ]);
  });

  it("disambiguates same-named cameras (e.g. docking ports) by part title", async () => {
    // Hullcam names every docking-port camera "NavCam", colliding with the
    // dedicated NavCam. The colliding pair gets its part title appended; the
    // non-colliding camera (and the NavCam whose title equals its name) stay
    // plain.
    await buildConnectedSource([
      makeCamera({
        flightId: 42,
        cameraName: "NavCam",
        vesselName: "Kerbal X",
        partTitle: "NavCam",
      }),
      makeCamera({
        flightId: 43,
        cameraName: "NavCam",
        vesselName: "Kerbal X",
        partTitle: "Clamp-O-Tron Docking Port Jr.",
      }),
      makeCamera({
        flightId: 44,
        cameraName: "Tail Cam",
        vesselName: "Kerbal X",
        partTitle: "Some Other Part",
      }),
    ]);

    renderFeed({ flightId: null });

    fireEvent.click(screen.getByRole("button", { name: /navcam/i }));
    const labels = screen
      .getAllByRole("menuitemradio")
      .map((item) => item.textContent);
    expect(labels).toEqual([
      "NavCam (Kerbal X)",
      "NavCam - Clamp-O-Tron Docking Port Jr. (Kerbal X)",
      "Tail Cam (Kerbal X)",
    ]);
  });

  it("auto-selects the first available camera when flightId is null", async () => {
    await buildConnectedSource(TWO_CAMERAS);

    renderFeed({ flightId: null });

    // Title reflects the first camera; the menu marks it as the checked item.
    expect(screen.getByRole("heading", { name: "Starboard Cam" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /starboard cam/i }));
    const checked = screen.getByRole("menuitemradio", { checked: true });
    expect(checked.textContent).toBe("Starboard Cam (Kerbal X)");
  });

  it("honours an explicitly-configured non-top camera", async () => {
    await buildConnectedSource(TWO_CAMERAS);

    // flightId 44 is the THIRD camera, not the top of the list.
    renderFeed({ flightId: 44 });

    expect(screen.getByRole("heading", { name: "Tail Cam" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /tail cam/i }));
    const checked = screen.getByRole("menuitemradio", { checked: true });
    expect(checked.textContent).toBe("Tail Cam (Kerbal X)");
  });

  it("selecting a different camera in the menu persists the choice and switches", async () => {
    await buildConnectedSource(TWO_CAMERAS);

    renderStatefulFeed({ flightId: 42 });

    expect(screen.getByRole("heading", { name: "Starboard Cam" })).toBeTruthy();

    // Open the menu and pick a different camera.
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /starboard cam/i }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("menuitemradio", { name: /nose cam/i }));
    });

    // Stateful harness persisted the new flightId → widget re-rendered.
    expect(screen.getByRole("heading", { name: "Nose Cam" })).toBeTruthy();
    // Selecting a camera closes the menu.
    expect(screen.queryByRole("menu")).toBeNull();

    // Re-open: the menu now marks the newly-chosen camera as checked.
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /nose cam/i }));
    });
    expect(
      screen.getByRole("menuitemradio", { checked: true }).textContent,
    ).toBe("Nose Cam (Kerbal X)");
  });

  it("Next button advances to the next camera and wraps round", async () => {
    await buildConnectedSource(TWO_CAMERAS);

    renderStatefulFeed({ flightId: 42 });

    const next = screen.getByRole("button", { name: /next camera/i });

    await act(async () => {
      fireEvent.click(next);
    });
    expect(screen.getByRole("heading", { name: "Nose Cam" })).toBeTruthy();

    await act(async () => {
      fireEvent.click(next);
    });
    expect(screen.getByRole("heading", { name: "Tail Cam" })).toBeTruthy();

    // Wrap: third → first.
    await act(async () => {
      fireEvent.click(next);
    });
    expect(screen.getByRole("heading", { name: "Starboard Cam" })).toBeTruthy();
  });

  it("Previous button steps backward and wraps round", async () => {
    await buildConnectedSource(TWO_CAMERAS);

    renderStatefulFeed({ flightId: 42 });

    const prev = screen.getByRole("button", { name: /previous camera/i });

    // From the first camera, Previous wraps to the last.
    await act(async () => {
      fireEvent.click(prev);
    });
    expect(screen.getByRole("heading", { name: "Tail Cam" })).toBeTruthy();
  });

  it("nextCamera / prevCamera serial actions switch cameras", async () => {
    await buildConnectedSource(TWO_CAMERAS);

    renderStatefulFeed({ flightId: 42 });

    // Fire the serial-input action straight through the dispatcher, the same
    // path InputDispatcher uses for a mapped hardware button.
    await act(async () => {
      dispatchAction(TEST_INSTANCE_ID, "nextCamera", {
        kind: "button",
        value: true,
      });
    });
    expect(screen.getByRole("heading", { name: "Nose Cam" })).toBeTruthy();

    await act(async () => {
      dispatchAction(TEST_INSTANCE_ID, "prevCamera", {
        kind: "button",
        value: true,
      });
    });
    expect(screen.getByRole("heading", { name: "Starboard Cam" })).toBeTruthy();
  });

  it("a button-release payload (value=false) does not switch cameras", async () => {
    await buildConnectedSource(TWO_CAMERAS);

    renderStatefulFeed({ flightId: 42 });

    await act(async () => {
      dispatchAction(TEST_INSTANCE_ID, "nextCamera", {
        kind: "button",
        value: false,
      });
    });
    // Still on the first camera — release events are ignored.
    expect(screen.getByRole("heading", { name: "Starboard Cam" })).toBeTruthy();
  });

  it("falls back to the first camera when the configured one disappears", async () => {
    const { sidecar } = await buildConnectedSource(TWO_CAMERAS);

    renderFeed({ flightId: 44 });
    expect(screen.getByRole("heading", { name: "Tail Cam" })).toBeTruthy();

    // The vessel changes — only flightId 42 survives.
    await act(async () => {
      sidecar.setCameras([
        toInit(makeCamera({ flightId: 42, cameraName: "Starboard Cam" })),
      ]);
    });

    // Configured 44 is gone → widget falls back to the surviving first camera
    // rather than wedging on a dead id.
    expect(screen.getByRole("heading", { name: "Starboard Cam" })).toBeTruthy();
  });

  it("step buttons are disabled when only one camera is available", async () => {
    await buildConnectedSource();

    renderFeed({ flightId: 42 });

    // jest-dom's toBeDisabled() isn't wired into the kerbcast setup, so assert
    // the underlying `disabled` property directly.
    expect(
      screen.getByRole<HTMLButtonElement>("button", { name: /next camera/i })
        .disabled,
    ).toBe(true);
    expect(
      screen.getByRole<HTMLButtonElement>("button", {
        name: /previous camera/i,
      }).disabled,
    ).toBe(true);
  });

  it("Escape closes the open camera menu", async () => {
    await buildConnectedSource(TWO_CAMERAS);

    renderFeed({ flightId: 42 });

    fireEvent.click(screen.getByRole("button", { name: /starboard cam/i }));
    expect(screen.getByRole("menu")).toBeTruthy();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Debug-info toggle (resolution + bitrate readouts gated behind the menu)
// ---------------------------------------------------------------------------

describe("CameraFeed — debug info toggle", () => {
  it("hides the resolution/bitrate readout by default", async () => {
    await buildConnectedSource([
      makeCamera({
        flightId: 42,
        cameraName: "Starboard Cam",
        vesselName: "Kerbal X",
        renderWidth: 640,
        renderHeight: 360,
      }),
    ]);

    renderFeed({ flightId: 42 });

    // showDebugInfo defaults to false → resolution string is not rendered.
    expect(screen.queryByText(/640×360/)).toBeNull();
  });

  it("shows the resolution/bitrate readout when showDebugInfo is true", async () => {
    await buildConnectedSource([
      makeCamera({
        flightId: 42,
        cameraName: "Starboard Cam",
        vesselName: "Kerbal X",
        renderWidth: 640,
        renderHeight: 360,
      }),
    ]);

    renderFeed({ flightId: 42, showDebugInfo: true });

    expect(screen.getByText(/640×360/)).toBeTruthy();
  });

  it("the Settings-tab config panel persists the toggle without dropping the camera pick", () => {
    // The toggle lives in the gear modal's Settings tab now, not the in-feed
    // dropdown. Saving must thread the current flightId back through so it
    // can't wipe the selected camera.
    const onSave = vi.fn();
    render(
      <CameraFeedConfigPanel
        config={{ flightId: 42, showDebugInfo: false }}
        onSave={onSave}
      />,
    );

    const toggle = screen.getByRole("checkbox", { name: /show debug info/i });
    expect((toggle as HTMLInputElement).checked).toBe(false);

    fireEvent.click(toggle);
    fireEvent.click(screen.getByRole("button", { name: /save/i }));

    expect(onSave).toHaveBeenCalledWith({ flightId: 42, showDebugInfo: true });
  });
});

describe("CameraFeed — empty state and status", () => {
  it("shows the no-cameras empty state and hides the menu trigger when connected with no cameras", async () => {
    await buildConnectedSource([]);

    renderFeed({ flightId: null });

    // No menu trigger (the title is plain text) when there are no cameras.
    expect(screen.queryByRole("button", { name: /camera feed/i })).toBeNull();
    // No <video> element either.
    expect(document.querySelector("video")).toBeNull();
    // Neutral empty-state copy — connection/transport detail is intentionally
    // NOT shown here (it lives in the Data Sources widget).
    expect(screen.getByText(/start a vessel with hullcam parts/i)).toBeTruthy();
  });

  it("renders the empty state gracefully when the source is disconnected", async () => {
    // A kerbcast source that never connects (status stays disconnected): build
    // the transport but never call connect()/open(). The widget shows the same
    // neutral empty state and surfaces no in-widget connection status.
    const sidecar = new MockSidecar();
    const ds = new KerbcastDataSource({ port: 1 }, sidecar.createTransport());
    registerUplinkHandle("kerbcast", ds);
    createdSources.push(ds);

    renderFeed({ flightId: null });

    expect(screen.getByText(/start a vessel with hullcam parts/i)).toBeTruthy();
    // No in-widget sidecar status indicator (removed — lives in Data Sources).
    expect(
      screen.queryByRole("status", { name: /connected|disconnected/i }),
    ).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Serial-action dispatch (zoom / pan) -- wrapper binding tests
//
// These tests drive the serial-input path: dispatchAction -> useActionInput
// handler -> feedRef.current.setZoomRate / setPanAxis -> PanZoomController
// -> client.camera(42).setZoomRate / setPanRate -> MockSidecar wire command.
// The shared package tests cover the handle directly; these tests cover the
// gonogo wrapper's useActionInput binding.
// ---------------------------------------------------------------------------

describe("CameraFeed -- serial-action dispatch (zoom/pan)", () => {
  it("zoomIn serial action holds a +1 zoom rate, releases to 0", async () => {
    const { sidecar } = await buildConnectedSource();

    await act(async () => {
      sidecar.updateCamera(42, { supportsZoom: true, fov: 60 });
    });

    renderFeed({ flightId: 42 });

    // Press: +rate = zoom in (FoV decreases). The plugin integrates per frame.
    await act(async () => {
      dispatchAction(TEST_INSTANCE_ID, "zoomIn", {
        kind: "button",
        value: true,
      });
    });
    expect(sidecar.lastCommand("set-zoom-rate")?.content).toMatchObject({
      flightId: 42,
      rate: 1,
    });

    // Release: stop zooming.
    await act(async () => {
      dispatchAction(TEST_INSTANCE_ID, "zoomIn", {
        kind: "button",
        value: false,
      });
    });
    expect(sidecar.lastCommand("set-zoom-rate")?.content.rate).toBe(0);
  });

  it("zoomOut serial action holds a -1 zoom rate, releases to 0", async () => {
    const { sidecar } = await buildConnectedSource();

    await act(async () => {
      sidecar.updateCamera(42, { supportsZoom: true, fov: 60 });
    });

    renderFeed({ flightId: 42 });

    await act(async () => {
      dispatchAction(TEST_INSTANCE_ID, "zoomOut", {
        kind: "button",
        value: true,
      });
    });
    expect(sidecar.lastCommand("set-zoom-rate")?.content).toMatchObject({
      flightId: 42,
      rate: -1,
    });

    await act(async () => {
      dispatchAction(TEST_INSTANCE_ID, "zoomOut", {
        kind: "button",
        value: false,
      });
    });
    expect(sidecar.lastCommand("set-zoom-rate")?.content.rate).toBe(0);
  });

  it("zoom serial actions are no-ops when camera does not support zoom", async () => {
    // Default camera fixture has supportsZoom: false -- handle guard blocks the command.
    const { sidecar } = await buildConnectedSource();

    renderFeed({ flightId: 42 });

    await act(async () => {
      dispatchAction(TEST_INSTANCE_ID, "zoomIn", {
        kind: "button",
        value: true,
      });
    });

    expect(sidecar.lastCommand("set-zoom-rate")).toBeUndefined();
  });

  it("panYaw serial action sends a set-pan-rate on the yaw axis", async () => {
    const { sidecar } = await buildConnectedSource();

    // Enable pan with a non-zero pitch range so supportsPitch is true and the
    // pitch axis is available (panPitchMax - panPitchMin > 0).
    await act(async () => {
      sidecar.updateCamera(42, {
        supportsPan: true,
        panYawMin: -45,
        panYawMax: 45,
        panPitchMin: -30,
        panPitchMax: 30,
      });
    });

    renderFeed({ flightId: 42 });

    await act(async () => {
      dispatchAction(TEST_INSTANCE_ID, "panYaw", {
        kind: "analog",
        value: 0.5,
      });
    });

    expect(sidecar.lastCommand("set-pan-rate")?.content).toMatchObject({
      flightId: 42,
      yawRate: 0.5,
      pitchRate: 0,
    });
  });

  it("panPitch serial action sends a set-pan-rate on the pitch axis", async () => {
    const { sidecar } = await buildConnectedSource();

    await act(async () => {
      sidecar.updateCamera(42, {
        supportsPan: true,
        panYawMin: -45,
        panYawMax: 45,
        panPitchMin: -30,
        panPitchMax: 30,
      });
    });

    renderFeed({ flightId: 42 });

    await act(async () => {
      dispatchAction(TEST_INSTANCE_ID, "panPitch", {
        kind: "analog",
        value: 0.5,
      });
    });

    expect(sidecar.lastCommand("set-pan-rate")?.content).toMatchObject({
      flightId: 42,
      yawRate: 0,
      pitchRate: 0.5,
    });
  });

  it("pan serial actions are no-ops when camera does not support pan", async () => {
    // Default camera fixture has supportsPan: false -- handle guard blocks the command.
    const { sidecar } = await buildConnectedSource();

    renderFeed({ flightId: 42 });

    await act(async () => {
      dispatchAction(TEST_INSTANCE_ID, "panYaw", { kind: "analog", value: 1 });
    });

    expect(sidecar.lastCommand("set-pan-rate")).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// CommNet degrade
// ---------------------------------------------------------------------------

describe("CameraFeed — CommNet degrade", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("CommNet degrade 0 when signal is full strength", async () => {
    const { sidecar } = await buildConnectedSource();

    // Register a fake "data" source with comm values pre-set
    const dataSource = makeDataSource("data", {
      "comm.signalStrength": 1.0,
      "comm.connected": true,
    });
    registerDataSource(
      dataSource as unknown as Parameters<typeof registerDataSource>[0],
    );

    renderFeed({ flightId: 42 });

    // Allow queueMicrotask-delivered initial values to land
    await act(async () => {
      await Promise.resolve();
    });

    // Advance past the 500ms debounce
    await act(async () => {
      vi.advanceTimersByTime(501);
    });

    const degradeMsg = sidecar.lastCommand("set-degrade");
    expect(degradeMsg).toBeTruthy();
    expect(degradeMsg?.content.flightId).toBe(42);
    // 1 - 1.0 = 0
    expect(degradeMsg?.content.level).toBe(0);
  });

  it("weak signal maps to a proportional degrade level (1 - signalStrength)", async () => {
    const { sidecar } = await buildConnectedSource();

    const dataSource = makeDataSource("data", {
      "comm.signalStrength": 0.3,
      "comm.connected": true,
    });
    registerDataSource(
      dataSource as unknown as Parameters<typeof registerDataSource>[0],
    );

    renderFeed({ flightId: 42 });

    await act(async () => {
      await Promise.resolve();
    });
    await act(async () => {
      vi.advanceTimersByTime(501);
    });

    const degradeMsg = sidecar.lastCommand("set-degrade");
    expect(degradeMsg?.content.flightId).toBe(42);
    // 1 - 0.3 = 0.7, clamped to [0, 1]
    expect(degradeMsg?.content.level).toBeCloseTo(0.7);
  });

  it("comm disconnected applies maximum degrade (level 1.0)", async () => {
    const { sidecar } = await buildConnectedSource();

    const dataSource = makeDataSource("data", {
      "comm.signalStrength": 1.0,
      "comm.connected": false,
    });
    registerDataSource(
      dataSource as unknown as Parameters<typeof registerDataSource>[0],
    );

    renderFeed({ flightId: 42 });

    await act(async () => {
      await Promise.resolve();
    });
    await act(async () => {
      vi.advanceTimersByTime(501);
    });

    const degradeMsg = sidecar.lastCommand("set-degrade");
    expect(degradeMsg?.content.flightId).toBe(42);
    // commConnected === false -> level 1.0 regardless of signalStrength
    expect(degradeMsg?.content.level).toBe(1.0);
  });

  it("auto-mode (flightId: null) degrade targets the auto-picked camera", async () => {
    // When config.flightId is null, the wrapper resolves effectiveFlightId
    // independently (same latch algorithm as the shared component) and routes
    // degrade to the camera actually on screen, not to a null/undefined id.
    const { sidecar } = await buildConnectedSource([
      makeCamera({ flightId: 42, cameraName: "Starboard Cam" }),
    ]);

    const dataSource = makeDataSource("data", {
      "comm.signalStrength": 0.5,
      "comm.connected": true,
    });
    registerDataSource(
      dataSource as unknown as Parameters<typeof registerDataSource>[0],
    );

    // Auto mode: no explicit flightId configured.
    renderFeed({ flightId: null });

    await act(async () => {
      await Promise.resolve();
    });
    await act(async () => {
      vi.advanceTimersByTime(501);
    });

    const degradeMsg = sidecar.lastCommand("set-degrade");
    // The wrapper should have resolved effectiveFlightId = 42 (the auto-pick)
    // and routed the degrade command there.
    expect(degradeMsg?.content.flightId).toBe(42);
    expect(degradeMsg?.content.level).toBeCloseTo(0.5);
  });
});

// ---------------------------------------------------------------------------
// Signal delay + signal quality badges — always-on header chrome, distinct
// from the CommNet-degrade effect above (that drives the SDK's video
// degradation; these are purely readouts). `comm.signalDelay` maps to
// `comms.delay.oneWaySeconds` — the badge is ONE-WAY, never doubled for
// round-trip (that's only for interactive command paths like the kOS
// terminal, which a camera downlink is not).
// ---------------------------------------------------------------------------

describe("CameraFeed — signal delay + signal quality badges", () => {
  it("shows the one-way signal delay badge as a one-decimal readout (sub-minute)", async () => {
    await buildConnectedSource();

    const dataSource = makeDataSource("data", {
      "comm.signalStrength": 1.0,
      "comm.connected": true,
      // A delay is a readout, not a countdown: sub-minute keeps one decimal
      // (3.8 -> "3.8s"), NOT formatDuration's whole-unit truncation, so the
      // operator sees the real light-time.
      "comm.signalDelay": 3.8,
    });
    registerDataSource(
      dataSource as unknown as Parameters<typeof registerDataSource>[0],
    );

    renderFeed({ flightId: 42 });

    expect(await screen.findByText("3.8s")).toBeTruthy();
    expect(screen.getByLabelText("Signal delay: 3.8s one-way")).toBeTruthy();
  });

  it("shows a multi-unit one-way signal delay (e.g. deep-space distances)", async () => {
    await buildConnectedSource();

    const dataSource = makeDataSource("data", {
      "comm.signalStrength": 1.0,
      "comm.connected": true,
      "comm.signalDelay": 80,
    });
    registerDataSource(
      dataSource as unknown as Parameters<typeof registerDataSource>[0],
    );

    renderFeed({ flightId: 42 });

    expect(await screen.findByText("1m 20s")).toBeTruthy();
    expect(screen.getByLabelText("Signal delay: 1m 20s one-way")).toBeTruthy();
  });

  it("hides the delay badge when the delay is zero (LAN / no delay authority)", async () => {
    await buildConnectedSource();

    const dataSource = makeDataSource("data", {
      "comm.signalStrength": 1.0,
      "comm.connected": true,
      "comm.signalDelay": 0,
    });
    registerDataSource(
      dataSource as unknown as Parameters<typeof registerDataSource>[0],
    );

    renderFeed({ flightId: 42 });

    await screen.findByRole("button", { name: /starboard cam/i });
    expect(screen.queryByLabelText(/signal delay/i)).toBeNull();
  });

  it("hides the delay badge when no delay data has ever arrived", async () => {
    await buildConnectedSource();

    const dataSource = makeDataSource("data", {
      "comm.signalStrength": 1.0,
      "comm.connected": true,
    });
    registerDataSource(
      dataSource as unknown as Parameters<typeof registerDataSource>[0],
    );

    renderFeed({ flightId: 42 });

    await screen.findByRole("button", { name: /starboard cam/i });
    expect(screen.queryByLabelText(/signal delay/i)).toBeNull();
  });

  it("shows the signal quality badge as a percentage", async () => {
    await buildConnectedSource();

    const dataSource = makeDataSource("data", {
      "comm.signalStrength": 0.72,
      "comm.connected": true,
    });
    registerDataSource(
      dataSource as unknown as Parameters<typeof registerDataSource>[0],
    );

    renderFeed({ flightId: 42 });

    expect(await screen.findByText("72%")).toBeTruthy();
    expect(screen.getByLabelText("Signal quality: 72%")).toBeTruthy();
  });

  it("shows a clear no-signal state when comm.connected is false", async () => {
    await buildConnectedSource();

    const dataSource = makeDataSource("data", {
      "comm.signalStrength": 0.72,
      "comm.connected": false,
    });
    registerDataSource(
      dataSource as unknown as Parameters<typeof registerDataSource>[0],
    );

    renderFeed({ flightId: 42 });

    expect(await screen.findByText("NO SIGNAL")).toBeTruthy();
    expect(screen.getByLabelText("Signal quality: no signal")).toBeTruthy();
    // The stale strength percentage is not shown alongside a lost link.
    expect(screen.queryByText("72%")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Station (brokered) mode — the widget runs the SAME hooks, but the data source
// is in brokered mode: the WebRTC handshake relays through the host (the
// `negotiate` seam) and TURN comes from the relay broadcast. Driven by the
// SDK's canonical `MockSidecar` (the protocol-level fake), proving the camera
// UI works on a station, not just the main screen.
// ---------------------------------------------------------------------------

describe("CameraFeed — station (brokered) mode", () => {
  async function buildBrokeredSource(
    cams: Array<{ flightId: number; cameraName: string; vesselName: string }>,
  ): Promise<{ ds: KerbcastDataSource; sidecar: MockSidecar }> {
    const sidecar = new MockSidecar();
    for (const c of cams) {
      sidecar.addCamera({
        flightId: c.flightId,
        cameraName: c.cameraName,
        vesselName: c.vesselName,
        supportsZoom: false,
      });
    }
    const ds = new KerbcastDataSource({ port: 1 }, sidecar.createTransport());
    // Brokered: the offer→answer round-trips through the (faked) host instead
    // of a localhost POST; TURN would come from the relay broadcast (none here).
    ds.attachBroker({
      negotiate: (offer) => sidecar.negotiate(offer),
      iceServers: () => [],
      onIceServersChange: () => () => {},
    });
    registerUplinkHandle("kerbcast", ds);

    await act(async () => {
      await ds.connect();
    });
    await act(async () => {
      sidecar.open(); // hello + camera-snapshot
      sidecar.setConnectionState("connected");
    });
    createdSources.push(ds);
    return { ds, sidecar };
  }

  it("lists the host-relayed cameras and shows the selected one", async () => {
    await buildBrokeredSource([
      { flightId: 42, cameraName: "Starboard Cam", vesselName: "Kerbal X" },
      { flightId: 43, cameraName: "Nose Cam", vesselName: "Kerbal X" },
    ]);

    renderFeed({ flightId: 42 });

    expect(screen.getByRole("heading", { name: "Starboard Cam" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /starboard cam/i }));
    const labels = screen
      .getAllByRole("menuitemradio")
      .map((item) => item.textContent);
    expect(labels).toEqual(["Starboard Cam (Kerbal X)", "Nose Cam (Kerbal X)"]);
  });

  it("subscribes the displayed camera through the broker (slot bound)", async () => {
    const { sidecar } = await buildBrokeredSource([
      { flightId: 42, cameraName: "Starboard Cam", vesselName: "Kerbal X" },
    ]);

    renderFeed({ flightId: 42 });

    // The mounted widget's useKerbcastStream subscribed flightId 42, which the
    // sidecar answered with a slot binding — same dynamic path as the main
    // screen, but every message rode the brokered connection.
    await waitFor(() => {
      expect(sidecar.slotMidFor(42)).toBeDefined();
    });
    expect(sidecar.lastCommand("subscribe", 42)).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Augment slots (Uplink architecture spec §4). CameraFeed exposes an OVERLAY
// slot (`camera-feed.overlay`, over the video) and a BADGES slot
// (`camera-feed.badges`, feed header). No first-party augment fills either
// (P3/P6): an empty slot renders cleanly, and a test augment registered into it
// appears, receiving the displayed camera's flightID as typed slot props (§4.4).
// ---------------------------------------------------------------------------

describe("CameraFeed — augment slots (spec §4)", () => {
  it("exposes both slots (empty until an augment registers)", () => {
    // No augment bound → the registry lists none for either slot.
    expect(getAugmentsForSlot("camera-feed.overlay")).toEqual([]);
    expect(getAugmentsForSlot("camera-feed.badges")).toEqual([]);
  });

  it("renders the feed with no augments bound (empty slots are inert)", async () => {
    await buildConnectedSource();
    renderFeed({ flightId: 42 });

    // The stock feed renders; empty slots add nothing over the video.
    await screen.findByRole("button", { name: /starboard cam/i });
    expect(screen.queryByTestId("cam-overlay-augment")).toBeNull();
    expect(screen.queryByTestId("cam-badge-augment")).toBeNull();
  });

  it("renders a test augment bound to the overlay slot, passing the displayed camera as slot props", async () => {
    function OverlayAugment({ flightId, width, height }: CameraOverlayContext) {
      return (
        <div data-testid="cam-overlay-augment">
          HUD:{flightId ?? "none"}:{width}x{height}
        </div>
      );
    }
    await buildConnectedSource();
    renderFeed({ flightId: 42 });

    act(() => {
      registerAugment({
        id: "test-cam-overlay",
        augments: "camera-feed.overlay",
        component: OverlayAugment,
      });
    });

    const augment = await screen.findByTestId("cam-overlay-augment");
    // The slot passed the displayed camera's flightID down (spec §4.4). The
    // measured size is 0×0 under jsdom's no-op ResizeObserver stub.
    await waitFor(() => expect(augment.textContent).toBe("HUD:42:0x0"));
  });

  it("renders a test augment bound to the badges slot in the header", async () => {
    function BadgeAugment({ flightId }: CameraBadgesContext) {
      return <span data-testid="cam-badge-augment">CAM {flightId}</span>;
    }
    await buildConnectedSource();
    renderFeed({ flightId: 42 });

    act(() => {
      registerAugment({
        id: "test-cam-badge",
        augments: "camera-feed.badges",
        component: BadgeAugment,
      });
    });

    const badge = await screen.findByTestId("cam-badge-augment");
    await waitFor(() => expect(badge.textContent).toBe("CAM 42"));
  });
});
