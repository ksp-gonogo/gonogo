/**
 * Tests for the `CameraFeed` component.
 *
 * Two halves:
 *  - the "SIGNAL LOST" overlay + zoom / pan / resize / CommNet feedback
 *    controls (carried over from the original kerbcam smoke);
 *  - the camera-selection layer (picker, Next/Previous buttons, the
 *    `nextCamera` / `prevCamera` serial-input actions, status indicator
 *    and empty state) that mirrors the OCISLY `CameraFeed`.
 *
 * Everything drives the real `KerbcamDataSource` + real `useKerbcamCameras`
 * / `useKerbcamStream` hooks through the SDK's canonical `MockSidecar`
 * (`@jonpepler/kerbcam/testing`) — the protocol-level fake that owns a camera
 * registry and speaks the full kerbcam wire protocol. The only thing faked is
 * the WebRTC transport, because jsdom can't produce a real `MediaStream`.
 * Multi-camera scenarios are expressed by populating the sidecar's registry
 * (`addCamera` / `setCameras`); state changes go through `updateCamera` /
 * `destroyCamera`; client commands are inspected via the parsed `commands`
 * array.
 */

import type {
  ComponentProps,
  DataSource,
  DataSourceStatus,
} from "@gonogo/core";
import {
  clearActionHandlers,
  clearRegistry,
  DashboardItemContext,
  dispatchAction,
  registerDataSource,
} from "@gonogo/core";
import {
  type CameraLifecycle,
  type ClientMessage,
  Layer,
} from "@jonpepler/kerbcam";
import { type MockCameraInit, MockSidecar } from "@jonpepler/kerbcam/testing";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { KerbcamDataSource } from "../KerbcamDataSource";
import { CameraFeed, type CameraFeedConfig } from "./CameraFeed";

// ---------------------------------------------------------------------------
// Render helper — CameraFeed calls useActionInput, which reads its instance
// ID from the enclosing DashboardItemContext. Rendering the component bare
// throws ("must be used inside a DashboardItemContext.Provider"), so every
// test goes through this wrapper. Mirrors CameraFeed/index.test.tsx's
// renderFeed(). The instanceId is also what dispatchAction() targets when a
// test drives the serial-input path directly.
// ---------------------------------------------------------------------------

const TEST_INSTANCE_ID = "camera-feed-test";

function renderFeed(
  config: CameraFeedConfig,
  onConfigChange?: ComponentProps<CameraFeedConfig>["onConfigChange"],
): ReturnType<typeof render> {
  return render(
    <DashboardItemContext.Provider value={{ instanceId: TEST_INSTANCE_ID }}>
      <CameraFeed
        config={config}
        id={TEST_INSTANCE_ID}
        onConfigChange={onConfigChange}
      />
    </DashboardItemContext.Provider>,
  );
}

// A stateful wrapper that holds `config` in React state and feeds its own
// setter back as `onConfigChange`. Lets selection tests assert the *real*
// round-trip — pick a camera (picker, Next/Prev button, or a dispatched
// serial action) → onConfigChange persists flightId → the widget re-renders
// against the new selection — rather than just spying on the callback.
function renderStatefulFeed(
  initial: CameraFeedConfig,
): ReturnType<typeof render> {
  function Harness() {
    const [config, setConfig] = useState<CameraFeedConfig>(initial);
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
  return render(<Harness />);
}

// Note: importing KerbcamDataSource class directly (not the barrel index)
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
function kerbcamFetch(
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
  vi.spyOn(globalThis, "fetch").mockImplementation(kerbcamFetch([42]));
});

afterEach(() => {
  cleanup();
  clearActionHandlers(); // tests share one instanceId — handlers would leak
  clearRegistry(); // resets all registries — tests register their own instance
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Test fixture: builds and registers a KerbcamDataSource with a fake
// transport, connects it, opens the control channel, and pushes an initial
// camera snapshot. Defaults to a single active "Starboard Cam" (flightId 42)
// matching the original single-camera fixture; pass `cameras` for the
// multi-camera selection scenarios.
// ---------------------------------------------------------------------------

async function buildConnectedSource(
  cameras: CameraStateLike[] = [
    makeCamera({ flightId: 42, cameraName: "Starboard Cam" }),
  ],
): Promise<{ ds: KerbcamDataSource; sidecar: MockSidecar }> {
  const sidecar = new MockSidecar();
  for (const c of cameras) {
    sidecar.addCamera(toInit(c));
  }
  const ds = new KerbcamDataSource(
    { host: "h", port: 1 },
    sidecar.createTransport(),
  );

  registerDataSource(ds as unknown as Parameters<typeof registerDataSource>[0]);

  // Keep the /offer answer's `cameras` array in sync with the snapshot so the
  // client opens a track for every flightId it's about to learn about.
  vi.spyOn(globalThis, "fetch").mockImplementation(
    kerbcamFetch(cameras.map((c) => c.flightId)),
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

  it("lists every available camera in the picker", async () => {
    const { ds } = await buildConnectedSource(TWO_CAMERAS);

    renderFeed({ flightId: null });

    const picker = screen.getByRole("combobox", { name: /camera/i });
    const labels = Array.from(picker.querySelectorAll("option")).map(
      (o) => o.textContent,
    );
    expect(labels).toEqual([
      "Starboard Cam (Kerbal X)",
      "Nose Cam (Kerbal X)",
      "Tail Cam (Kerbal X)",
    ]);

    ds.disconnect();
  });

  it("auto-selects the first available camera when flightId is null", async () => {
    const { ds } = await buildConnectedSource(TWO_CAMERAS);

    renderFeed({ flightId: null });

    // Title reflects the first camera; picker value points at its flightId.
    expect(screen.getByRole("heading", { name: "Starboard Cam" })).toBeTruthy();
    const picker = screen.getByRole<HTMLSelectElement>("combobox", {
      name: /camera/i,
    });
    expect(picker.value).toBe("42");

    ds.disconnect();
  });

  it("honours an explicitly-configured non-top camera", async () => {
    const { ds } = await buildConnectedSource(TWO_CAMERAS);

    // flightId 44 is the THIRD camera, not the top of the list.
    renderFeed({ flightId: 44 });

    expect(screen.getByRole("heading", { name: "Tail Cam" })).toBeTruthy();
    const picker = screen.getByRole<HTMLSelectElement>("combobox", {
      name: /camera/i,
    });
    expect(picker.value).toBe("44");

    ds.disconnect();
  });

  it("selecting a different camera in the picker persists the choice and switches", async () => {
    const { ds } = await buildConnectedSource(TWO_CAMERAS);

    renderStatefulFeed({ flightId: 42 });

    expect(screen.getByRole("heading", { name: "Starboard Cam" })).toBeTruthy();

    const picker = screen.getByRole<HTMLSelectElement>("combobox", {
      name: /camera/i,
    });
    await act(async () => {
      fireEvent.change(picker, { target: { value: "43" } });
    });

    // Stateful harness persisted the new flightId → widget re-rendered.
    expect(screen.getByRole("heading", { name: "Nose Cam" })).toBeTruthy();
    const switched = screen.getByRole<HTMLSelectElement>("combobox", {
      name: /camera/i,
    });
    expect(switched.value).toBe("43");

    ds.disconnect();
  });

  it("Next button advances to the next camera and wraps round", async () => {
    const { ds } = await buildConnectedSource(TWO_CAMERAS);

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

    ds.disconnect();
  });

  it("Previous button steps backward and wraps round", async () => {
    const { ds } = await buildConnectedSource(TWO_CAMERAS);

    renderStatefulFeed({ flightId: 42 });

    const prev = screen.getByRole("button", { name: /previous camera/i });

    // From the first camera, Previous wraps to the last.
    await act(async () => {
      fireEvent.click(prev);
    });
    expect(screen.getByRole("heading", { name: "Tail Cam" })).toBeTruthy();

    ds.disconnect();
  });

  it("nextCamera / prevCamera serial actions switch cameras", async () => {
    const { ds } = await buildConnectedSource(TWO_CAMERAS);

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

    ds.disconnect();
  });

  it("a button-release payload (value=false) does not switch cameras", async () => {
    const { ds } = await buildConnectedSource(TWO_CAMERAS);

    renderStatefulFeed({ flightId: 42 });

    await act(async () => {
      dispatchAction(TEST_INSTANCE_ID, "nextCamera", {
        kind: "button",
        value: false,
      });
    });
    // Still on the first camera — release events are ignored.
    expect(screen.getByRole("heading", { name: "Starboard Cam" })).toBeTruthy();

    ds.disconnect();
  });

  it("falls back to the first camera when the configured one disappears", async () => {
    const { ds, sidecar } = await buildConnectedSource(TWO_CAMERAS);

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

    ds.disconnect();
  });

  it("step buttons are disabled when only one camera is available", async () => {
    const { ds } = await buildConnectedSource();

    renderFeed({ flightId: 42 });

    // jest-dom's toBeDisabled() isn't wired into the kerbcam setup, so assert
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

    ds.disconnect();
  });
});

describe("CameraFeed — empty state and status", () => {
  it("shows the no-cameras empty state and hides the picker when connected with no cameras", async () => {
    const { ds } = await buildConnectedSource([]);

    renderFeed({ flightId: null });

    // No picker when there are no cameras.
    expect(screen.queryByRole("combobox", { name: /camera/i })).toBeNull();
    // No <video> element either.
    expect(document.querySelector("video")).toBeNull();
    // Neutral empty-state copy — connection/transport detail is intentionally
    // NOT shown here (it lives in the Data Sources widget).
    expect(screen.getByText(/start a vessel with hullcam parts/i)).toBeTruthy();

    ds.disconnect();
  });

  it("renders the empty state gracefully when the source is disconnected", async () => {
    // A kerbcam source that never connects (status stays disconnected): build
    // the transport but never call connect()/open(). The widget shows the same
    // neutral empty state and surfaces no in-widget connection status.
    const sidecar = new MockSidecar();
    const ds = new KerbcamDataSource(
      { host: "h", port: 1 },
      sidecar.createTransport(),
    );
    registerDataSource(
      ds as unknown as Parameters<typeof registerDataSource>[0],
    );

    renderFeed({ flightId: null });

    expect(screen.getByText(/start a vessel with hullcam parts/i)).toBeTruthy();
    // No in-widget sidecar status indicator (removed — lives in Data Sources).
    expect(
      screen.queryByRole("status", { name: /connected|disconnected/i }),
    ).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// SIGNAL LOST overlay
// ---------------------------------------------------------------------------

describe("CameraFeed — SIGNAL LOST overlay", () => {
  it("does not render SIGNAL LOST overlay when camera is active", async () => {
    const { ds } = await buildConnectedSource();

    renderFeed({ flightId: 42 });

    expect(screen.queryByRole("status", { name: /signal lost/i })).toBeNull();

    ds.disconnect();
  });

  it("renders SIGNAL LOST overlay when camera lifecycle transitions to destroyed", async () => {
    const { ds, sidecar } = await buildConnectedSource();

    renderFeed({ flightId: 42 });

    // Confirm the overlay is absent before the destruction event.
    expect(screen.queryByRole("status", { name: /signal lost/i })).toBeNull();

    // Simulate the sidecar reporting the camera's part destroyed — flips the
    // lifecycle to Destroyed and pushes camera-state-changed.
    await act(async () => {
      sidecar.destroyCamera(42);
    });

    // The overlay must now be visible with "SIGNAL LOST" text.
    const overlay = screen.getByRole("status", { name: /signal lost/i });
    expect(overlay).toBeTruthy();
    expect(overlay.textContent).toMatch(/SIGNAL LOST/i);

    ds.disconnect();
  });

  it("renders SIGNAL LOST overlay from initial snapshot when camera starts destroyed", async () => {
    const { ds } = await buildConnectedSource([
      makeCamera({
        flightId: 99,
        lifecycle: "destroyed",
        partTitle: "Hullcam Mk2",
        cameraName: "Nose Cam",
        vesselName: "Debris Field",
        layers: [],
        operatorLayers: [],
        renderWidth: 0,
        renderHeight: 0,
        operatorWidth: 0,
        operatorHeight: 0,
        fov: 0,
        encoderBitrateBps: 0,
      }),
    ]);

    renderFeed({ flightId: 99 });

    const overlay = await screen.findByRole("status", { name: /signal lost/i });
    expect(overlay).toBeTruthy();
    expect(overlay.textContent).toMatch(/SIGNAL LOST/i);

    ds.disconnect();
  });
});

// ---------------------------------------------------------------------------
// Zoom controls
// ---------------------------------------------------------------------------

describe("CameraFeed — zoom controls", () => {
  it("zoom controls appear when camera supportsZoom", async () => {
    const { ds, sidecar } = await buildConnectedSource();

    renderFeed({ flightId: 42 });

    // Initially supportsZoom is false — apply a partial update to flip it.
    await act(async () => {
      sidecar.updateCamera(42, {
        partTitle: "Hullcam Mk1 Zoom",
        supportsZoom: true,
      });
    });

    expect(screen.getByRole("button", { name: /zoom in/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /zoom out/i })).toBeTruthy();

    ds.disconnect();
  });

  it("zoom controls absent when camera does not support zoom", async () => {
    const { ds } = await buildConnectedSource();

    renderFeed({ flightId: 42 });

    // buildConnectedSource() fixture creates a camera with supportsZoom: false
    expect(screen.queryByRole("button", { name: /zoom in/i })).toBeNull();

    ds.disconnect();
  });
});

// ---------------------------------------------------------------------------
// ResizeObserver render-size feedback
// ---------------------------------------------------------------------------

describe("CameraFeed — ResizeObserver render-size feedback", () => {
  let resizeCallback:
    | ((entries: ResizeObserverEntry[], observer: ResizeObserver) => void)
    | undefined;
  const originalResizeObserver = globalThis.ResizeObserver;

  beforeEach(() => {
    vi.useFakeTimers();
    globalThis.ResizeObserver = class {
      constructor(
        cb: (entries: ResizeObserverEntry[], observer: ResizeObserver) => void,
      ) {
        resizeCallback = cb;
      }
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver;
  });

  afterEach(() => {
    vi.useRealTimers();
    globalThis.ResizeObserver = originalResizeObserver;
    resizeCallback = undefined;
  });

  it("render-size observer fires set-render-size command", async () => {
    const { ds, sidecar } = await buildConnectedSource();

    renderFeed({ flightId: 42 });

    // Fire the resize observer callback with a 400-wide contentRect (height is
    // ignored — the widget derives a 16:9 frame from the width).
    await act(async () => {
      resizeCallback?.(
        [{ contentRect: { width: 400, height: 400 } }] as ResizeObserverEntry[],
        {} as ResizeObserver,
      );
    });

    // Advance fake timers past the 500ms debounce
    await act(async () => {
      vi.advanceTimersByTime(501);
    });

    const renderSizeMsg = sidecar.lastCommand("set-render-size");
    expect(renderSizeMsg).toBeTruthy();
    // Width as-is (already even); height derived 16:9 then rounded to the
    // nearest even px (H.264 chroma): 400 * 9/16 = 225 → 226.
    expect(renderSizeMsg?.content.width).toBe(400);
    expect(renderSizeMsg?.content.height).toBe(226);

    ds.disconnect();
  });
});

// ---------------------------------------------------------------------------
// Pan reticle
// ---------------------------------------------------------------------------

describe("CameraFeed — pan reticle", () => {
  // The partial applied to the default flightId-42 camera to make it steerable:
  // a ±45° yaw / ±30° pitch range with pan enabled. Mirrors the old full-camera
  // PAN_CAMERA fixture, expressed as the changed fields for `updateCamera`.
  const PAN_FLIP = {
    supportsPan: true,
    panYawMin: -45,
    panYawMax: 45,
    panPitchMin: -30,
    panPitchMax: 30,
    layers: [Layer.Near],
    operatorLayers: [Layer.Near],
  };

  it("pan controls appear when camera supportsPan", async () => {
    const { ds, sidecar } = await buildConnectedSource();

    renderFeed({ flightId: 42 });

    // Flip supportsPan on via a partial state update.
    await act(async () => {
      sidecar.updateCamera(42, PAN_FLIP);
    });

    expect(screen.getByRole("button", { name: /pan left/i })).toBeTruthy();
    // The pan flip gives a pitch range, so the pitch arrows are enabled.
    expect(
      (screen.getByRole("button", { name: /pan up/i }) as HTMLButtonElement)
        .disabled,
    ).toBe(false);

    ds.disconnect();
  });

  it("pan controls absent when camera does not support pan", async () => {
    const { ds } = await buildConnectedSource();

    renderFeed({ flightId: 42 });

    // buildConnectedSource() fixture has supportsPan: false
    expect(screen.queryByRole("button", { name: /pan left/i })).toBeNull();

    ds.disconnect();
  });

  it("holding a pan arrow streams set-pan; releasing stops it", async () => {
    vi.useFakeTimers();

    const { ds, sidecar } = await buildConnectedSource();

    await act(async () => {
      sidecar.updateCamera(42, PAN_FLIP);
    });

    renderFeed({ flightId: 42 });

    const leftArrow = screen.getByRole("button", { name: /pan left/i });

    const setPanMsgs = () =>
      sidecar.commands.filter(
        (c): c is Extract<ClientMessage, { type: "set-pan" }> =>
          c.type === "set-pan",
      );

    // Hold the arrow — the rate loop fires an absolute set-pan each tick.
    await act(async () => {
      leftArrow.dispatchEvent(
        new PointerEvent("pointerdown", { bubbles: true }),
      );
    });
    await act(async () => {
      vi.advanceTimersByTime(160); // ~3 ticks at 50ms
    });

    const held = setPanMsgs();
    expect(held.length).toBeGreaterThan(1);
    expect(held[0].content.flightId).toBe(42);
    // Panning left drives yaw negative from 0, and it keeps moving each tick.
    expect(held.at(-1)?.content.yaw).toBeLessThan(0);
    expect(held.at(-1)?.content.yaw).toBeLessThan(held[0].content.yaw ?? 0);

    // Release — the loop must stop; no further set-pan after the next tick.
    await act(async () => {
      leftArrow.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));
    });
    await act(async () => {
      vi.advanceTimersByTime(300);
    });
    expect(setPanMsgs().length).toBe(held.length);

    ds.disconnect();
    vi.useRealTimers();
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
    const { ds, sidecar } = await buildConnectedSource();

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

    ds.disconnect();
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
  ): Promise<{ ds: KerbcamDataSource; sidecar: MockSidecar }> {
    const sidecar = new MockSidecar();
    for (const c of cams) {
      sidecar.addCamera({
        flightId: c.flightId,
        cameraName: c.cameraName,
        vesselName: c.vesselName,
        supportsZoom: false,
      });
    }
    const ds = new KerbcamDataSource(
      { host: "h", port: 1 },
      sidecar.createTransport(),
    );
    // Brokered: the offer→answer round-trips through the (faked) host instead
    // of a localhost POST; TURN would come from the relay broadcast (none here).
    ds.attachBroker({
      negotiate: (offer) => sidecar.negotiate(offer),
      iceServers: () => [],
      onIceServersChange: () => () => {},
    });
    registerDataSource(
      ds as unknown as Parameters<typeof registerDataSource>[0],
    );

    await act(async () => {
      await ds.connect();
    });
    await act(async () => {
      sidecar.open(); // hello + camera-snapshot
      sidecar.setConnectionState("connected");
    });
    return { ds, sidecar };
  }

  it("lists the host-relayed cameras and shows the selected one", async () => {
    const { ds } = await buildBrokeredSource([
      { flightId: 42, cameraName: "Starboard Cam", vesselName: "Kerbal X" },
      { flightId: 43, cameraName: "Nose Cam", vesselName: "Kerbal X" },
    ]);

    renderFeed({ flightId: 42 });

    expect(screen.getByRole("heading", { name: "Starboard Cam" })).toBeTruthy();
    const picker = screen.getByRole("combobox", { name: /camera/i });
    const labels = Array.from(picker.querySelectorAll("option")).map(
      (o) => o.textContent,
    );
    expect(labels).toEqual(["Starboard Cam (Kerbal X)", "Nose Cam (Kerbal X)"]);

    ds.disconnect();
  });

  it("subscribes the displayed camera through the broker (slot bound)", async () => {
    const { ds, sidecar } = await buildBrokeredSource([
      { flightId: 42, cameraName: "Starboard Cam", vesselName: "Kerbal X" },
    ]);

    renderFeed({ flightId: 42 });

    // The mounted widget's useKerbcamStream subscribed flightId 42, which the
    // sidecar answered with a slot binding — same dynamic path as the main
    // screen, but every message rode the brokered connection.
    await waitFor(() => {
      expect(sidecar.slotMidFor(42)).toBeDefined();
    });
    expect(sidecar.lastCommand("subscribe", 42)).toBeTruthy();

    ds.disconnect();
  });
});
