/**
 * Tests for the `ExpCameraFeed` component — specifically the "SIGNAL LOST"
 * overlay that renders when the sidecar reports `lifecycle: "destroyed"` for
 * a camera (e.g. the Hullcam part was struck by debris or fell below physics
 * range). The last decoded video frame remains visible behind the overlay
 * (the HTML video element retains it naturally; we don't need to assert that
 * in a jsdom environment where no real video decoding runs).
 */

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
