import type { TopicId } from "@ksp-gonogo/sitrep-sdk";
import {
  AugmentSlot,
  clearRegistry,
  Quality,
  registerUplinkHandle,
  useTelemetry,
} from "@ksp-gonogo/sitrep-sdk";
import {
  act,
  clearUplinkHandles,
  render,
  type StreamFixture,
  setupStreamFixture,
  waitFor,
} from "@ksp-gonogo/sitrep-sdk/testing";
import {
  DomainAvailabilityProvider,
  useDomainAvailabilityStore,
} from "@ksp-gonogo/ui-kit";
import { useEffect } from "react";
import { beforeEach, describe, expect, it } from "vitest";
// Importing the real module runs its module-load `registerAugment(...)` once,
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

// AugmentSlot's presence gate reads ui-kit's DomainAvailability store, not the
// stream directly. The app mounts an AugmentAvailabilityFeeder that bridges
// `<domain>.available` telemetry into that store; this test-local feeder mirrors
// it for `kerbcast` so the suite still exercises "the Domain announces on the
// stream, then the augment mounts and subscribes" end to end.
function KerbcastAvailabilityFeeder() {
  const store = useDomainAvailabilityStore();
  const reading = useTelemetry("kerbcast.available" as TopicId);
  useEffect(() => {
    // A presence gate asks "has the domain ever reported?", which is the `pending`
    // arm now: a `Reading` is never `undefined`, so the old spelling announced the
    // domain before anything arrived and the "does not subscribe until announced"
    // case could not fail.
    store?.setAvailable("kerbcast", reading.state !== "pending");
  }, [store, reading]);
  return null;
}

/** The topics this slot's availability gate and inventory read run on. */
const SLOT_TOPICS = ["kerbcast.available", "kerbcast.cameras"] as const;

function renderSlot(stream: StreamFixture) {
  return render(
    <stream.Provider>
      <DomainAvailabilityProvider>
        <KerbcastAvailabilityFeeder />
        <AugmentSlot name="targeting.camera" props={HUD_CONTEXT} />
      </DomainAvailabilityProvider>
    </stream.Provider>,
  );
}

describe("kerbcast docking-camera augment: targeting.camera slot", () => {
  beforeEach(() => {
    clearRegistry();
    clearUplinkHandles();
  });

  it("does not subscribe to the camera inventory before kerbcast announces availability", () => {
    const stream = setupStreamFixture({ carriedChannels: SLOT_TOPICS });
    renderSlot(stream);

    // Presence-gated: with no `kerbcast.available`, the augment never mounts,
    // so it never reaches for kerbcast's control channel. This is what makes a
    // no-kerbcast install cost the docking HUD nothing.
    expect(stream.transport.isSubscribed("kerbcast.cameras")).toBe(false);
  });

  it("subscribes to kerbcast.cameras once the domain is live", async () => {
    const stream = setupStreamFixture({ carriedChannels: SLOT_TOPICS });
    renderSlot(stream);

    act(() => {
      stream.emit("kerbcast.available", true, {
        quality: Quality.Loaded,
        source: "kerbcast",
      });
    });

    await waitFor(() =>
      expect(stream.transport.isSubscribed("kerbcast.cameras")).toBe(true),
    );
  });

  it("renders no video layer when the inventory is empty, the HUD composes without it", async () => {
    const stream = setupStreamFixture({ carriedChannels: SLOT_TOPICS });
    const { container } = renderSlot(stream);

    act(() => {
      stream.emit("kerbcast.available", true, {
        quality: Quality.Loaded,
        source: "kerbcast",
      });
    });
    await waitFor(() =>
      expect(stream.transport.isSubscribed("kerbcast.cameras")).toBe(true),
    );
    act(() => {
      stream.emit("kerbcast.cameras", [], {
        quality: Quality.Loaded,
        source: "kerbcast",
      });
    });

    expect(container.querySelector("video")).toBeNull();
  });

  it("stays absent with no TelemetryProvider at all (no stream mounted)", () => {
    const { container } = render(
      <AugmentSlot name="targeting.camera" props={HUD_CONTEXT} />,
    );
    expect(container.querySelector("video")).toBeNull();
  });

  // The two planes are separate, so naming a camera on the CONTROL channel must
  // also kick the MEDIA connection: nothing else will. `subscribeCamera` only
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
      // read the capture clock for delayed playout, like CameraFeed), so the
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

    const stream = setupStreamFixture({ carriedChannels: SLOT_TOPICS });
    renderSlot(stream);

    act(() => {
      stream.emit("kerbcast.available", true, {
        quality: Quality.Loaded,
        source: "kerbcast",
      });
    });
    await waitFor(() =>
      expect(stream.transport.isSubscribed("kerbcast.cameras")).toBe(true),
    );

    // No camera named yet -> nothing to connect for.
    expect(ensureConnectedCalls).toBe(0);

    act(() => {
      stream.emit(
        "kerbcast.cameras",
        [{ cameraId: 7, isDockingCamera: true }],
        { quality: Quality.Loaded, source: "kerbcast" },
      );
    });

    await waitFor(() => expect(ensureConnectedCalls).toBeGreaterThan(0));
  });
});
