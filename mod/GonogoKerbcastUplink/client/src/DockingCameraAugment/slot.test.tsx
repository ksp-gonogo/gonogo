import { clearRegistry, clearUplinkHandles } from "@ksp-gonogo/core";
import {
  StubTransport,
  TelemetryClient,
  TelemetryProvider,
} from "@ksp-gonogo/sitrep-client";
import {
  AugmentSlot,
  Quality,
  registerUplinkHandle,
} from "@ksp-gonogo/sitrep-sdk";
import { act, render, waitFor } from "@ksp-gonogo/test-utils";
import { beforeEach, describe, expect, it } from "vitest";
// Importing the real module runs its module-load `registerAugment(...)` once —
// the same way the app picks this augment up via the package's bare
// `import "./DockingCameraAugment"`. So this suite exercises the ACTUAL
// production registration and deliberately never calls `clearAugments()`:
// that would wipe the one real registration this file exists to check, and
// re-importing an already-evaluated ES module is a no-op, so it'd never
// come back.
import "./index";

const HUD_CONTEXT = {
  maxDeg: 8,
  reticleOffset: { x: 0, y: 0 },
  reticleTravelPct: 40,
  aligned: false,
  ax: undefined,
  ay: undefined,
  distance: 42,
  cameraFlightId: undefined,
};

function renderSlot(transport: StubTransport) {
  const client = new TelemetryClient(transport);
  return render(
    <TelemetryProvider client={client}>
      <AugmentSlot name="distance-to-target.camera" props={HUD_CONTEXT} />
    </TelemetryProvider>,
  );
}

describe("kerbcast docking-camera augment — distance-to-target.camera slot", () => {
  beforeEach(() => {
    clearRegistry();
    clearUplinkHandles();
  });

  it("does not subscribe to the camera inventory before kerbcast announces availability", () => {
    const transport = new StubTransport();
    renderSlot(transport);

    // Presence-gated: with no `kerbcast.available`, the augment never mounts,
    // so it never reaches for kerbcast's control channel. This is what makes a
    // no-kerbcast install cost the docking HUD nothing.
    expect(transport.isSubscribed("kerbcast.cameras")).toBe(false);
  });

  it("subscribes to kerbcast.cameras once the domain is live", async () => {
    const transport = new StubTransport();
    renderSlot(transport);

    act(() => {
      transport.emit("kerbcast.available", true, {
        quality: Quality.Loaded,
        source: "kerbcast",
      });
    });

    await waitFor(() =>
      expect(transport.isSubscribed("kerbcast.cameras")).toBe(true),
    );
  });

  it("renders no video layer when the inventory is empty — the HUD composes without it", async () => {
    const transport = new StubTransport();
    const { container } = renderSlot(transport);

    act(() => {
      transport.emit("kerbcast.available", true, {
        quality: Quality.Loaded,
        source: "kerbcast",
      });
    });
    await waitFor(() =>
      expect(transport.isSubscribed("kerbcast.cameras")).toBe(true),
    );
    act(() => {
      transport.emit("kerbcast.cameras", [], {
        quality: Quality.Loaded,
        source: "kerbcast",
      });
    });

    expect(container.querySelector("video")).toBeNull();
  });

  it("stays absent with no TelemetryProvider at all (no stream mounted)", () => {
    const { container } = render(
      <AugmentSlot name="distance-to-target.camera" props={HUD_CONTEXT} />,
    );
    expect(container.querySelector("video")).toBeNull();
  });

  // The two planes are separate, so naming a camera on the CONTROL channel must
  // also kick the MEDIA connection — nothing else will. `subscribeCamera` only
  // binds a slot on an already-connected source, so without this a brokered
  // station is named a camera it never opens a session for. Regression guard:
  // the built-in HudCamera got its connect free via `useKerbcastCameras`.
  it("ensures the media connection once the Uplink names a camera", async () => {
    let ensureConnectedCalls = 0;
    const fakeSource = {
      id: "kerbcast",
      name: "Kerbcast",
      ensureConnected: () => {
        ensureConnectedCalls++;
      },
      subscribeCamera: () => {},
      unsubscribeCamera: () => {},
      // Once a camera is named the augment mounts its own KerbcastProvider (to
      // read the capture clock for delayed playout, like CameraFeed) — so the
      // client must satisfy `useKerbcastClock`: a `clock` snapshot and a
      // `settings-change` subscription. `captureUt: null` keeps it a live
      // passthrough (no clock yet), which is all this connect-path test needs.
      getClient: () => ({
        clock: { captureUt: null, epoch: 0, warpRate: 1 },
        on: () => () => {},
        camera: () => ({ mediaStream: null, on: () => () => {} }),
      }),
    };
    registerUplinkHandle("kerbcast", fakeSource);

    const transport = new StubTransport();
    renderSlot(transport);

    act(() => {
      transport.emit("kerbcast.available", true, {
        quality: Quality.Loaded,
        source: "kerbcast",
      });
    });
    await waitFor(() =>
      expect(transport.isSubscribed("kerbcast.cameras")).toBe(true),
    );

    // No camera named yet -> nothing to connect for.
    expect(ensureConnectedCalls).toBe(0);

    act(() => {
      transport.emit(
        "kerbcast.cameras",
        [{ cameraId: 7, isDockingCamera: true }],
        { quality: Quality.Loaded, source: "kerbcast" },
      );
    });

    await waitFor(() => expect(ensureConnectedCalls).toBeGreaterThan(0));
  });
});
