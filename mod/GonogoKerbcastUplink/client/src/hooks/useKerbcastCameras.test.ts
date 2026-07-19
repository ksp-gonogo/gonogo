/**
 * useKerbcastCameras — live camera-registry snapshot.
 *
 * Exercises the real hook against a real KerbcastDataSource, with only the
 * WebRTC transport faked by the SDK's canonical MockSidecar.
 */

import { clearUplinkHandles } from "@ksp-gonogo/core";
import { MockSidecar } from "@ksp-gonogo/kerbcast/testing";
import { registerUplinkHandle } from "@ksp-gonogo/sitrep-sdk";
import { renderHook, waitFor } from "@ksp-gonogo/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { KerbcastDataSource } from "../KerbcastDataSource";
import { useKerbcastCameras } from "./useKerbcastCameras";

afterEach(() => {
  clearUplinkHandles();
  vi.restoreAllMocks();
});

describe("useKerbcastCameras", () => {
  it("returns the empty list when no kerbcast handle is registered", () => {
    const { result } = renderHook(() => useKerbcastCameras());
    expect(result.current).toEqual([]);
  });

  it("returns the live camera snapshot once a handle is registered and connected", async () => {
    const sidecar = new MockSidecar();
    sidecar.addCamera({ flightId: 42, cameraName: "Starboard Cam" });
    const ds = new KerbcastDataSource({ port: 1 }, sidecar.createTransport());
    registerUplinkHandle("kerbcast", ds);
    vi.spyOn(globalThis, "fetch").mockImplementation((input) =>
      Promise.resolve(
        String(input).includes("/ice-config")
          ? new Response(JSON.stringify({ iceServers: [] }), { status: 200 })
          : MockSidecar.makeOfferResponse([42]),
      ),
    );
    await ds.connect();
    sidecar.open();
    sidecar.setConnectionState("connected");

    const { result } = renderHook(() => useKerbcastCameras());
    await waitFor(() => expect(result.current).toHaveLength(1));
    expect(result.current[0]?.flightId).toBe(42);
    ds.disconnect();
  });
});
