/**
 * Tests for the `ExpCameraFeed` component — specifically the "SIGNAL LOST"
 * overlay that renders when the sidecar reports `lifecycle: "destroyed"` for
 * a camera (e.g. the Hullcam part was struck by debris or fell below physics
 * range). The last decoded video frame remains visible behind the overlay
 * (the HTML video element retains it naturally; we don't need to assert that
 * in a jsdom environment where no real video decoding runs).
 */

import type { DataSource, DataSourceStatus } from "@gonogo/core";
import { clearRegistry, registerDataSource } from "@gonogo/core";
import type {
  KerbcamDataChannel,
  KerbcamPeer,
  KerbcamTransport,
} from "@jonpepler/kerbcam";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { KerbcamDataSource } from "../KerbcamDataSource";
import { ExpCameraFeed } from "./ExpCameraFeed";

// Note: importing KerbcamDataSource class directly (not the barrel index)
// avoids the module-level registerDataSource() side effect. Tests register
// their own instance explicitly via registerDataSource() in each fixture.

// ---------------------------------------------------------------------------
// Fake transport — reused from KerbcamDataSource.test.ts pattern
// ---------------------------------------------------------------------------

type CapturedChannel = KerbcamDataChannel & {
  sent: string[];
  _open: () => void;
};

function makeFakeTransport() {
  const captured: {
    dc?: CapturedChannel;
    onState?: (
      s: "disconnected" | "connecting" | "connected" | "failed",
    ) => void;
    onMessage?: (raw: string) => void;
    closed: boolean;
  } = { closed: false };

  const transport: KerbcamTransport = {
    createPeer: (_iceServers) => {
      const ch: CapturedChannel = {
        sent: [],
        send: (s: string) => ch.sent.push(s),
        onOpen: (h: () => void) => {
          ch._open = h;
        },
        onMessage: (h: (raw: string) => void) => {
          captured.onMessage = h;
        },
        onClose: () => {},
        _open: () => {},
      };
      const peer: KerbcamPeer = {
        addRecvOnlyTransceiver: () => {},
        createDataChannel: () => {
          captured.dc = ch;
          return ch;
        },
        onTrack: () => {},
        onStateChange: (h) => {
          captured.onState = h;
        },
        createOffer: async () => "v=0\r\n",
        setLocalDescription: async () => {},
        setRemoteAnswer: async () => {},
        waitForIceComplete: async () => {},
        localSdp: () => "v=0\r\n",
        close: () => {
          captured.closed = true;
        },
      };
      return peer;
    },
  };

  return { transport, captured };
}

// ---------------------------------------------------------------------------
// Helper: push a server message through the fake data channel.
// ---------------------------------------------------------------------------

function pushServerMessage(
  captured: ReturnType<typeof makeFakeTransport>["captured"],
  msg: object,
) {
  captured.onMessage?.(JSON.stringify(msg));
}

// ---------------------------------------------------------------------------
// Test fixture: builds and registers a KerbcamDataSource with a fake
// transport, connects it, opens the control channel.
// ---------------------------------------------------------------------------

async function buildConnectedSource() {
  const { transport, captured } = makeFakeTransport();
  const ds = new KerbcamDataSource({ host: "h", port: 1 }, transport);

  registerDataSource(ds as unknown as Parameters<typeof registerDataSource>[0]);

  await act(async () => {
    await ds.connect();
  });

  // Open the control channel and complete the Hello handshake.
  await act(async () => {
    captured.dc?._open();
    captured.onState?.("connected");
    // Simulate sidecar hello + initial camera snapshot with one active camera.
    pushServerMessage(captured, {
      type: "hello",
      content: { sidecarVersion: "0.3.2", encoderBackend: "openh264" },
    });
    pushServerMessage(captured, {
      type: "camera-snapshot",
      content: {
        cameras: [
          {
            flightId: 42,
            lifecycle: "active",
            partName: "mumech.MuMechModuleHullCamera",
            partTitle: "Hullcam Mk1",
            cameraName: "Starboard Cam",
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
            encoderBitrateBps: 1500000,
            targetBitrateBps: 0,
            degradeLevel: 0,
          },
        ],
      },
    });
  });

  return { ds, captured };
}

// ---------------------------------------------------------------------------
// Minimal in-memory DataSource for "data" (CommNet) source stub
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
  clearRegistry(); // resets all registries — tests register their own instance
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ExpCameraFeed — SIGNAL LOST overlay", () => {
  it("does not render SIGNAL LOST overlay when camera is active", async () => {
    const { ds } = await buildConnectedSource();

    render(<ExpCameraFeed config={{ flightId: 42 }} />);

    expect(screen.queryByRole("status", { name: /signal lost/i })).toBeNull();

    ds.disconnect();
  });

  it("renders SIGNAL LOST overlay when camera lifecycle transitions to destroyed", async () => {
    const { ds, captured } = await buildConnectedSource();

    render(<ExpCameraFeed config={{ flightId: 42 }} />);

    // Confirm the overlay is absent before the destruction event.
    expect(screen.queryByRole("status", { name: /signal lost/i })).toBeNull();

    // Simulate the sidecar broadcasting camera-state-changed with destroyed lifecycle.
    await act(async () => {
      pushServerMessage(captured, {
        type: "camera-state-changed",
        content: {
          state: {
            flightId: 42,
            lifecycle: "destroyed",
            partName: "mumech.MuMechModuleHullCamera",
            partTitle: "Hullcam Mk1",
            cameraName: "Starboard Cam",
            vesselName: "Kerbal X",
            layers: [],
            operatorLayers: [],
            renderWidth: 0,
            renderHeight: 0,
            operatorWidth: 0,
            operatorHeight: 0,
            supportsZoom: false,
            fov: 0,
            fovMin: 10,
            fovMax: 90,
            supportsPan: false,
            panYaw: 0,
            panPitch: 0,
            panYawMin: 0,
            panYawMax: 0,
            panPitchMin: 0,
            panPitchMax: 0,
            encoderBitrateBps: 0,
            targetBitrateBps: 0,
            degradeLevel: 0,
          },
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
    const { transport, captured } = makeFakeTransport();
    const ds = new KerbcamDataSource({ host: "h", port: 1 }, transport);
    registerDataSource(
      ds as unknown as Parameters<typeof registerDataSource>[0],
    );

    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ sdp: "answer-sdp", cameras: [99] }), {
        status: 200,
      }),
    );

    await act(async () => {
      await ds.connect();
    });

    await act(async () => {
      captured.dc?._open();
      captured.onState?.("connected");
      // Snapshot where the camera arrives already destroyed (sidecar restarted
      // after the part was destroyed but before the tombstone was acknowledged).
      pushServerMessage(captured, {
        type: "hello",
        content: { sidecarVersion: "0.3.2", encoderBackend: "openh264" },
      });
      pushServerMessage(captured, {
        type: "camera-snapshot",
        content: {
          cameras: [
            {
              flightId: 99,
              lifecycle: "destroyed",
              partName: "mumech.MuMechModuleHullCamera",
              partTitle: "Hullcam Mk2",
              cameraName: "Nose Cam",
              vesselName: "Debris Field",
              layers: [],
              operatorLayers: [],
              renderWidth: 0,
              renderHeight: 0,
              operatorWidth: 0,
              operatorHeight: 0,
              supportsZoom: false,
              fov: 0,
              fovMin: 10,
              fovMax: 90,
              supportsPan: false,
              panYaw: 0,
              panPitch: 0,
              panYawMin: 0,
              panYawMax: 0,
              panPitchMin: 0,
              panPitchMax: 0,
              encoderBitrateBps: 0,
              targetBitrateBps: 0,
              degradeLevel: 0,
            },
          ],
        },
      });
    });

    render(<ExpCameraFeed config={{ flightId: 99 }} />);

    const overlay = await screen.findByRole("status", { name: /signal lost/i });
    expect(overlay).toBeTruthy();
    expect(overlay.textContent).toMatch(/SIGNAL LOST/i);

    ds.disconnect();
  });
});

// ---------------------------------------------------------------------------
// New feature tests
// ---------------------------------------------------------------------------

describe("ExpCameraFeed — zoom controls", () => {
  it("zoom controls appear when camera supportsZoom", async () => {
    const { ds, captured } = await buildConnectedSource();

    render(<ExpCameraFeed config={{ flightId: 42 }} />);

    // Initially supportsZoom is false — fire a camera-state-changed to flip it.
    await act(async () => {
      pushServerMessage(captured, {
        type: "camera-state-changed",
        content: {
          state: {
            flightId: 42,
            lifecycle: "active",
            partName: "mumech.MuMechModuleHullCameraZoom",
            partTitle: "Hullcam Mk1 Zoom",
            cameraName: "Starboard Cam",
            vesselName: "Kerbal X",
            layers: ["NEAR", "SCALED"],
            operatorLayers: ["NEAR", "SCALED"],
            renderWidth: 384,
            renderHeight: 384,
            operatorWidth: 384,
            operatorHeight: 384,
            supportsZoom: true,
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
            encoderBitrateBps: 1500000,
            targetBitrateBps: 0,
            degradeLevel: 0,
          },
        },
      });
    });

    const slider = screen.getByRole("slider", { name: /field of view/i });
    expect(slider).toBeTruthy();

    ds.disconnect();
  });

  it("zoom controls absent when camera does not support zoom", async () => {
    const { ds } = await buildConnectedSource();

    render(<ExpCameraFeed config={{ flightId: 42 }} />);

    // buildConnectedSource() fixture creates a camera with supportsZoom: false
    expect(screen.queryByRole("slider", { name: /field of view/i })).toBeNull();

    ds.disconnect();
  });
});

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
    const { ds, captured } = await buildConnectedSource();

    render(<ExpCameraFeed config={{ flightId: 42 }} />);

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

    const sent = captured.dc?.sent ?? [];
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

describe("ExpCameraFeed — pan reticle", () => {
  it("pan pad appears when camera supportsPan", async () => {
    const { ds, captured } = await buildConnectedSource();

    render(<ExpCameraFeed config={{ flightId: 42 }} />);

    // Flip supportsPan on via a state-changed event.
    await act(async () => {
      pushServerMessage(captured, {
        type: "camera-state-changed",
        content: {
          state: {
            flightId: 42,
            lifecycle: "active",
            partName: "mumech.MuMechModuleHullCamera",
            partTitle: "Hullcam Mk1",
            cameraName: "Starboard Cam",
            vesselName: "Kerbal X",
            layers: ["NEAR"],
            operatorLayers: ["NEAR"],
            renderWidth: 384,
            renderHeight: 384,
            operatorWidth: 384,
            operatorHeight: 384,
            supportsZoom: false,
            fov: 60,
            fovMin: 10,
            fovMax: 90,
            supportsPan: true,
            panYaw: 0,
            panPitch: 0,
            panYawMin: -45,
            panYawMax: 45,
            panPitchMin: -30,
            panPitchMax: 30,
            encoderBitrateBps: 0,
            targetBitrateBps: 0,
            degradeLevel: 0,
          },
        },
      });
    });

    const pad = screen.getByRole("slider", { name: /pan camera/i });
    expect(pad).toBeTruthy();

    ds.disconnect();
  });

  it("pan pad absent when camera does not support pan", async () => {
    const { ds } = await buildConnectedSource();

    render(<ExpCameraFeed config={{ flightId: 42 }} />);

    // buildConnectedSource() fixture has supportsPan: false
    expect(screen.queryByRole("slider", { name: /pan camera/i })).toBeNull();

    ds.disconnect();
  });

  it("drag on pan pad sends set-pan", async () => {
    vi.useFakeTimers();

    // jsdom doesn't implement pointer capture — stub it so pointerdown doesn't throw.
    const origSetPointerCapture = Element.prototype.setPointerCapture;
    Element.prototype.setPointerCapture = vi.fn();

    const { ds, captured } = await buildConnectedSource();

    // Enable pan with known bounds
    await act(async () => {
      pushServerMessage(captured, {
        type: "camera-state-changed",
        content: {
          state: {
            flightId: 42,
            lifecycle: "active",
            partName: "mumech.MuMechModuleHullCamera",
            partTitle: "Hullcam Mk1",
            cameraName: "Starboard Cam",
            vesselName: "Kerbal X",
            layers: ["NEAR"],
            operatorLayers: ["NEAR"],
            renderWidth: 384,
            renderHeight: 384,
            operatorWidth: 384,
            operatorHeight: 384,
            supportsZoom: false,
            fov: 60,
            fovMin: 10,
            fovMax: 90,
            supportsPan: true,
            panYaw: 0,
            panPitch: 0,
            panYawMin: -45,
            panYawMax: 45,
            panPitchMin: -30,
            panPitchMax: 30,
            encoderBitrateBps: 0,
            targetBitrateBps: 0,
            degradeLevel: 0,
          },
        },
      });
    });

    render(<ExpCameraFeed config={{ flightId: 42 }} />);

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

    const sent = captured.dc?.sent ?? [];
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

describe("ExpCameraFeed — CommNet degrade", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("CommNet degrade 0 when signal is full strength", async () => {
    const { ds, captured } = await buildConnectedSource();

    // Register a fake "data" source with comm values pre-set
    const dataSource = makeDataSource("data", {
      "comm.signalStrength": 1.0,
      "comm.connected": true,
    });
    registerDataSource(
      dataSource as unknown as Parameters<typeof registerDataSource>[0],
    );

    render(<ExpCameraFeed config={{ flightId: 42 }} />);

    // Allow queueMicrotask-delivered initial values to land
    await act(async () => {
      await Promise.resolve();
    });

    // Advance past the 500ms debounce
    await act(async () => {
      vi.advanceTimersByTime(501);
    });

    const sent = captured.dc?.sent ?? [];
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
