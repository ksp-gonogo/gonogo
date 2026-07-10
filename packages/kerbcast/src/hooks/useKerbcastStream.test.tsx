/**
 * useKerbcastStream slot-subscription lifecycle.
 *
 * Renders a probe component through the real hook + real KerbcastDataSource,
 * with only the WebRTC transport faked by the SDK's canonical MockSidecar.
 * Asserts the hook drives the dynamic-mode subscription: a slot binds while a
 * camera is on screen, switches when the selected flightId changes, and frees
 * on unmount.
 */

import { MockSidecar } from "@jonpepler/kerbcast/testing";
import { clearRegistry, registerDataSource } from "@ksp-gonogo/core";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { KerbcastDataSource } from "../KerbcastDataSource";
import { useKerbcastStream } from "./useKerbcastStream";

function StreamProbe({ flightId }: { flightId: number | null }): null {
  useKerbcastStream(flightId);
  return null;
}

afterEach(() => {
  cleanup();
  clearRegistry();
  vi.restoreAllMocks();
});

async function connectedSource(
  flightIds: number[] = [42, 43],
): Promise<{ ds: KerbcastDataSource; sidecar: MockSidecar }> {
  const sidecar = new MockSidecar();
  flightIds.forEach((flightId) => {
    sidecar.addCamera({ flightId });
  });
  vi.spyOn(globalThis, "fetch").mockImplementation((input) =>
    Promise.resolve(
      String(input).includes("/ice-config")
        ? new Response(JSON.stringify({ iceServers: [] }), { status: 200 })
        : MockSidecar.makeOfferResponse([]),
    ),
  );
  const ds = new KerbcastDataSource(
    { host: "h", port: 1 },
    sidecar.createTransport(),
  );
  registerDataSource(ds as unknown as Parameters<typeof registerDataSource>[0]);
  await act(async () => {
    await ds.connect();
  });
  await act(async () => {
    sidecar.open();
    sidecar.setConnectionState("connected");
  });
  return { ds, sidecar };
}

describe("useKerbcastStream — slot subscription lifecycle", () => {
  it("subscribes the camera on mount and releases it on unmount", async () => {
    const { sidecar } = await connectedSource();

    const { unmount } = render(<StreamProbe flightId={42} />);

    expect(sidecar.lastCommand("subscribe", 42)).toBeTruthy();
    expect(sidecar.slotMidFor(42)).toBeDefined();

    act(() => {
      unmount();
    });

    expect(sidecar.lastCommand("unsubscribe", 42)).toBeTruthy();
    expect(sidecar.slotMidFor(42)).toBeUndefined();
  });

  it("switches slots when the selected flightId changes", async () => {
    const { sidecar } = await connectedSource();

    const { rerender } = render(<StreamProbe flightId={42} />);
    expect(sidecar.slotMidFor(42)).toBeDefined();

    act(() => {
      rerender(<StreamProbe flightId={43} />);
    });

    expect(sidecar.slotMidFor(42)).toBeUndefined();
    expect(sidecar.slotMidFor(43)).toBeDefined();
  });

  it("does not subscribe when no camera is selected", async () => {
    const { sidecar } = await connectedSource();

    render(<StreamProbe flightId={null} />);

    expect(sidecar.commands.some((c) => c.type === "subscribe")).toBe(false);
  });
});
