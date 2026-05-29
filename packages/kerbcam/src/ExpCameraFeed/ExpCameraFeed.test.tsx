/**
 * Tests for the `ExpCameraFeed` component.
 *
 * Two halves:
 *  - the "SIGNAL LOST" overlay + zoom / pan / resize / CommNet feedback
 *    controls (carried over from the original kerbcam smoke);
 *  - the camera-selection layer (picker, Next/Previous buttons, the
 *    `nextCamera` / `prevCamera` serial-input actions, status indicator
 *    and empty state) that mirrors the OCISLY `CameraFeed`.
 *
 * Everything drives the real `KerbcamDataSource` + real `useKerbcamCameras`
 * / `useKerbcamStream` hooks through a fake transport
 * (`createMockKerbcamSession`); the only thing faked is the WebRTC
 * transport, because jsdom can't produce a real `MediaStream`. Multi-camera
 * scenarios are expressed purely as `camera-snapshot` payloads — the shared
 * `MockKerbcamSession` is a transport-level fake and needs no extension.
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
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { KerbcamDataSource } from "../KerbcamDataSource";
import {
  createMockKerbcamSession,
  type MockKerbcamSession,
} from "../test/MockKerbcamSession";
import { ExpCameraFeed, type ExpCameraFeedConfig } from "./ExpCameraFeed";

// ---------------------------------------------------------------------------
// Render helper — ExpCameraFeed calls useActionInput, which reads its instance
// ID from the enclosing DashboardItemContext. Rendering the component bare
// throws ("must be used inside a DashboardItemContext.Provider"), so every
// test goes through this wrapper. Mirrors CameraFeed/index.test.tsx's
// renderFeed(). The instanceId is also what dispatchAction() targets when a
// test drives the serial-input path directly.
// ---------------------------------------------------------------------------

const TEST_INSTANCE_ID = "exp-camera-feed-test";

function renderFeed(
  config: ExpCameraFeedConfig,
  onConfigChange?: ComponentProps<ExpCameraFeedConfig>["onConfigChange"],
): ReturnType<typeof render> {
  return render(
    <DashboardItemContext.Provider value={{ instanceId: TEST_INSTANCE_ID }}>
      <ExpCameraFeed
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
  initial: ExpCameraFeedConfig,
): ReturnType<typeof render> {
  function Harness() {
    const [config, setConfig] = useState<ExpCameraFeedConfig>(initial);
    return (
      <DashboardItemContext.Provider value={{ instanceId: TEST_INSTANCE_ID }}>
        <ExpCameraFeed
          config={config}
          id={TEST_INSTANCE_ID}
          onConfigChange={(next) => setConfig(next as ExpCameraFeedConfig)}
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
  vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(JSON.stringify({ sdp: "answer-sdp", cameras: [42] }), {
      status: 200,
    }),
  );
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
): Promise<{ ds: KerbcamDataSource; session: MockKerbcamSession }> {
  const session = createMockKerbcamSession();
  const ds = new KerbcamDataSource({ host: "h", port: 1 }, session.transport);

  registerDataSource(ds as unknown as Parameters<typeof registerDataSource>[0]);

  // Keep the /offer answer's `cameras` array in sync with the snapshot so the
  // client opens a track for every flightId it's about to learn about.
  vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(
      JSON.stringify({
        sdp: "answer-sdp",
        cameras: cameras.map((c) => c.flightId),
      }),
      { status: 200 },
    ),
  );

  await act(async () => {
    await ds.connect();
  });

  // Open the control channel and complete the Hello handshake.
  await act(async () => {
    session.openChannel();
    session.setState("connected");
    session.sendServerMessage({
      type: "hello",
      content: { sidecarVersion: "0.3.2", encoderBackend: "openh264" },
    });
    session.sendServerMessage({
      type: "camera-snapshot",
      content: { cameras },
    });
  });

  return { ds, session };
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

describe("ExpCameraFeed — camera selection", () => {
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
    const { ds, session } = await buildConnectedSource(TWO_CAMERAS);

    renderFeed({ flightId: 44 });
    expect(screen.getByRole("heading", { name: "Tail Cam" })).toBeTruthy();

    // The vessel changes — only flightId 42 survives.
    await act(async () => {
      session.sendServerMessage({
        type: "camera-snapshot",
        content: {
          cameras: [makeCamera({ flightId: 42, cameraName: "Starboard Cam" })],
        },
      });
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

describe("ExpCameraFeed — empty state and status", () => {
  it("shows the no-cameras empty state and hides the picker when connected with no cameras", async () => {
    const { ds } = await buildConnectedSource([]);

    renderFeed({ flightId: null });

    // No picker when there are no cameras.
    expect(screen.queryByRole("combobox", { name: /camera/i })).toBeNull();
    // No <video> element either.
    expect(document.querySelector("video")).toBeNull();
    // Empty-state copy tells the operator the sidecar IS up.
    expect(
      screen.getByText(/start a vessel with hullcams installed/i),
    ).toBeTruthy();

    ds.disconnect();
  });

  it("surfaces the sidecar connection status via a live status indicator", async () => {
    const { ds } = await buildConnectedSource();

    renderFeed({ flightId: 42 });

    // The status indicator is a named live region; scope by name so it does
    // not collide with the SIGNAL LOST overlay (also role="status").
    const status = screen.getByRole("status", { name: /sidecar connected/i });
    expect(status.textContent).toMatch(/sidecar connected/i);

    ds.disconnect();
  });

  it("renders the offline empty-state copy before the sidecar connects", async () => {
    // Register a kerbcam source that never connects (status stays disconnected).
    const session = createMockKerbcamSession();
    const ds = new KerbcamDataSource({ host: "h", port: 1 }, session.transport);
    registerDataSource(
      ds as unknown as Parameters<typeof registerDataSource>[0],
    );

    renderFeed({ flightId: null });

    expect(screen.getByText(/is the kerbcam sidecar running/i)).toBeTruthy();
    expect(
      screen.getByRole("status", { name: /sidecar disconnected/i }),
    ).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// SIGNAL LOST overlay
// ---------------------------------------------------------------------------

describe("ExpCameraFeed — SIGNAL LOST overlay", () => {
  it("does not render SIGNAL LOST overlay when camera is active", async () => {
    const { ds } = await buildConnectedSource();

    renderFeed({ flightId: 42 });

    expect(screen.queryByRole("status", { name: /signal lost/i })).toBeNull();

    ds.disconnect();
  });

  it("renders SIGNAL LOST overlay when camera lifecycle transitions to destroyed", async () => {
    const { ds, session } = await buildConnectedSource();

    renderFeed({ flightId: 42 });

    // Confirm the overlay is absent before the destruction event.
    expect(screen.queryByRole("status", { name: /signal lost/i })).toBeNull();

    // Simulate the sidecar broadcasting camera-state-changed with destroyed lifecycle.
    await act(async () => {
      session.sendServerMessage({
        type: "camera-state-changed",
        content: {
          state: makeCamera({
            flightId: 42,
            lifecycle: "destroyed",
            cameraName: "Starboard Cam",
            layers: [],
            operatorLayers: [],
            renderWidth: 0,
            renderHeight: 0,
            operatorWidth: 0,
            operatorHeight: 0,
            fov: 0,
            encoderBitrateBps: 0,
          }),
        },
      });
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

describe("ExpCameraFeed — zoom controls", () => {
  it("zoom controls appear when camera supportsZoom", async () => {
    const { ds, session } = await buildConnectedSource();

    renderFeed({ flightId: 42 });

    // Initially supportsZoom is false — fire a camera-state-changed to flip it.
    await act(async () => {
      session.sendServerMessage({
        type: "camera-state-changed",
        content: {
          state: makeCamera({
            flightId: 42,
            cameraName: "Starboard Cam",
            partTitle: "Hullcam Mk1 Zoom",
            supportsZoom: true,
          }),
        },
      });
    });

    const slider = screen.getByRole("slider", { name: /field of view/i });
    expect(slider).toBeTruthy();

    ds.disconnect();
  });

  it("zoom controls absent when camera does not support zoom", async () => {
    const { ds } = await buildConnectedSource();

    renderFeed({ flightId: 42 });

    // buildConnectedSource() fixture creates a camera with supportsZoom: false
    expect(screen.queryByRole("slider", { name: /field of view/i })).toBeNull();

    ds.disconnect();
  });
});

// ---------------------------------------------------------------------------
// ResizeObserver render-size feedback
// ---------------------------------------------------------------------------

describe("ExpCameraFeed — ResizeObserver render-size feedback", () => {
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
    const { ds, session } = await buildConnectedSource();

    renderFeed({ flightId: 42 });

    // Fire the resize observer callback with a 400×400 contentRect
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

    const sent = session.sentMessages;
    const parsed = sent.map(
      (s) =>
        JSON.parse(s) as {
          type: string;
          content: { width?: number; height?: number };
        },
    );
    const renderSizeMsg = parsed.find((m) => m.type === "set-render-size");
    expect(renderSizeMsg).toBeTruthy();
    // 400 is already even
    expect(renderSizeMsg?.content.width).toBe(400);
    expect(renderSizeMsg?.content.height).toBe(400);

    ds.disconnect();
  });
});

// ---------------------------------------------------------------------------
// Pan reticle
// ---------------------------------------------------------------------------

describe("ExpCameraFeed — pan reticle", () => {
  const PAN_CAMERA = makeCamera({
    flightId: 42,
    cameraName: "Starboard Cam",
    layers: ["NEAR"],
    operatorLayers: ["NEAR"],
    supportsPan: true,
    panYawMin: -45,
    panYawMax: 45,
    panPitchMin: -30,
    panPitchMax: 30,
    encoderBitrateBps: 0,
  });

  it("pan pad appears when camera supportsPan", async () => {
    const { ds, session } = await buildConnectedSource();

    renderFeed({ flightId: 42 });

    // Flip supportsPan on via a state-changed event.
    await act(async () => {
      session.sendServerMessage({
        type: "camera-state-changed",
        content: { state: PAN_CAMERA },
      });
    });

    const pad = screen.getByRole("slider", { name: /pan camera/i });
    expect(pad).toBeTruthy();

    ds.disconnect();
  });

  it("pan pad absent when camera does not support pan", async () => {
    const { ds } = await buildConnectedSource();

    renderFeed({ flightId: 42 });

    // buildConnectedSource() fixture has supportsPan: false
    expect(screen.queryByRole("slider", { name: /pan camera/i })).toBeNull();

    ds.disconnect();
  });

  it("drag on pan pad sends set-pan", async () => {
    vi.useFakeTimers();

    // jsdom doesn't implement pointer capture — stub it so pointerdown doesn't throw.
    const origSetPointerCapture = Element.prototype.setPointerCapture;
    Element.prototype.setPointerCapture = vi.fn();

    const { ds, session } = await buildConnectedSource();

    // Enable pan with known bounds
    await act(async () => {
      session.sendServerMessage({
        type: "camera-state-changed",
        content: { state: PAN_CAMERA },
      });
    });

    renderFeed({ flightId: 42 });

    const pad = screen.getByRole("slider", { name: /pan camera/i });

    // Mock getBoundingClientRect so the component's delta math uses a known size.
    vi.spyOn(pad, "getBoundingClientRect").mockReturnValue({
      width: 80,
      height: 80,
      left: 0,
      top: 0,
      right: 80,
      bottom: 80,
      x: 0,
      y: 0,
      toJSON: () => {},
    } as DOMRect);

    // Pointerdown at center, then move 40px right (half pad = 45° yaw from 0).
    await act(async () => {
      pad.dispatchEvent(
        new PointerEvent("pointerdown", {
          clientX: 40,
          clientY: 40,
          bubbles: true,
        }),
      );
    });
    await act(async () => {
      pad.dispatchEvent(
        new PointerEvent("pointermove", {
          clientX: 80,
          clientY: 40,
          bubbles: true,
        }),
      );
    });

    // Advance past the 50ms throttle
    await act(async () => {
      vi.advanceTimersByTime(51);
    });

    const sent = session.sentMessages;
    const parsed = sent.map(
      (s) =>
        JSON.parse(s) as {
          type: string;
          content: { flightId?: number; yaw?: number; pitch?: number };
        },
    );
    const panMsg = parsed.find((m) => m.type === "set-pan");
    expect(panMsg).toBeTruthy();
    expect(panMsg?.content.flightId).toBe(42);
    // 40px / 80px * 90° range = 45° from yaw=0
    expect(panMsg?.content.yaw).toBeCloseTo(45, 1);
    expect(panMsg?.content.pitch).toBeCloseTo(0, 1);

    Element.prototype.setPointerCapture = origSetPointerCapture;
    ds.disconnect();
    vi.useRealTimers();
  });
});

// ---------------------------------------------------------------------------
// CommNet degrade
// ---------------------------------------------------------------------------

describe("ExpCameraFeed — CommNet degrade", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("CommNet degrade 0 when signal is full strength", async () => {
    const { ds, session } = await buildConnectedSource();

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

    const sent = session.sentMessages;
    const parsed = sent.map(
      (s) =>
        JSON.parse(s) as {
          type: string;
          content: { flightId?: number; level?: number };
        },
    );
    const degradeMsg = parsed.find((m) => m.type === "set-degrade");
    expect(degradeMsg).toBeTruthy();
    expect(degradeMsg?.content.flightId).toBe(42);
    // 1 - 1.0 = 0
    expect(degradeMsg?.content.level).toBe(0);

    ds.disconnect();
  });
});
