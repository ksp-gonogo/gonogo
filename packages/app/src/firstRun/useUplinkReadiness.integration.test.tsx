import { clearRegistry } from "@ksp-gonogo/core";
import { renderHook, waitFor } from "@ksp-gonogo/test-utils";
import { ws } from "msw";
import { setupServer } from "msw/node";
import type { ReactNode } from "react";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";
import { SitrepTelemetryProvider } from "../telemetry/SitrepTelemetryProvider";
import {
  __resetUplinkOutcomes,
  setUplinkOutcome,
} from "../uplinks/loaderState";
import { useUplinkReadiness } from "./useUplinkReadiness";

/**
 * Proves the hook wires its two live inputs for real: the
 * `useStream<SystemUplinkHealth>("system.uplinkHealth")` read over a live
 * WebSocketTransport (the same MSW `ws` boundary `sitrep-stream-wire.test.tsx`
 * uses) and the real `loaderState` subscription. The join itself is covered
 * exhaustively by `useUplinkReadiness.test.ts` and is not re-tested here.
 */

const SITREP_URL = "ws://localhost:8090";
const link = ws.link(SITREP_URL);
const server = setupServer();

beforeAll(() => server.listen({ onUnhandledRequest: "bypass" }));
beforeEach(() => {
  __resetUplinkOutcomes();
  // Cleared here, not in `afterEach`: see FirstRunSetup.test.tsx for why the
  // hook ordering matters. The previous test's tree is already unmounted.
  clearRegistry();
});
afterEach(() => {
  server.resetHandlers();
});
afterAll(() => server.close());

function streamFrame(topic: string, payload: unknown): string {
  return JSON.stringify({
    type: "stream-data",
    topic,
    payload,
    meta: {
      source: "test",
      validAt: 1,
      seq: 0,
      deliveredAt: 1,
      vantage: "test",
      quality: 0,
      active: false,
      staleness: 0,
      timelineEpoch: 0,
    },
  });
}

function wrapper({ children }: { children: ReactNode }) {
  return (
    <SitrepTelemetryProvider enabled host="localhost" port={8090}>
      {children}
    </SitrepTelemetryProvider>
  );
}

function listenForClient() {
  const clients: Array<{ send: (data: string) => void }> = [];
  server.use(
    link.addEventListener("connection", ({ client }) => {
      clients.push(client as unknown as { send: (data: string) => void });
    }),
  );
  return clients;
}

describe("useUplinkReadiness: hook wiring", () => {
  it("waits for the mod, then reads a row off the live roster", async () => {
    const clients = listenForClient();
    const { result } = renderHook(() => useUplinkReadiness(), { wrapper });
    expect(result.current.waitingForMod).toBe(true);

    await waitFor(() => expect(clients).toHaveLength(1));
    clients[0].send(
      streamFrame("system.uplinks", {
        uplinks: [
          {
            id: "widget-a",
            version: "1.0.0",
            available: true,
            reason: null,
            health: { state: 0, detail: null },
          },
        ],
      }),
    );

    await waitFor(() => expect(result.current.waitingForMod).toBe(false));
    expect(result.current.entries).toEqual([
      expect.objectContaining({ id: "widget-a", state: "no-client" }),
    ]);
  });

  it("reflects an id already recorded loaded through the real outcome subscription", async () => {
    setUplinkOutcome({ id: "widget-a", name: "Widget A", status: "loaded" });
    const { result } = renderHook(() => useUplinkReadiness(), { wrapper });

    await waitFor(() =>
      expect(
        result.current.entries.find((entry) => entry.id === "widget-a")?.state,
      ).toBe("loaded"),
    );
  });
});
