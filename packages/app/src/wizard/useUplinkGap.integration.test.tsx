import { clearRegistry } from "@ksp-gonogo/core";
import { renderHook, waitFor } from "@ksp-gonogo/test-utils";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { HttpResponse, http, ws } from "msw";
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
import { useUplinkGap } from "./useUplinkGap";

/**
 * Proves `useUplinkGap` actually wires its three live inputs — the real
 * `useStream<SystemUplinkHealth>("system.uplinkHealth")` over a live
 * WebSocketTransport (same MSW `ws` boundary `sitrep-stream-wire.test.tsx`
 * uses), the real `loaderState` subscription, and a real `fetchRegistry`
 * HTTP call intercepted by MSW — rather than re-testing `computeUplinkGap`'s
 * join logic, which `useUplinkGap.test.ts` already covers exhaustively.
 */

const SITREP_URL = "ws://localhost:8090";
const link = ws.link(SITREP_URL);
const server = setupServer();

beforeAll(() => server.listen({ onUnhandledRequest: "bypass" }));
beforeEach(() => {
  __resetUplinkOutcomes();
});
afterEach(() => {
  server.resetHandlers();
  clearRegistry();
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
  const queryClient = new QueryClient();
  return (
    <QueryClientProvider client={queryClient}>
      <SitrepTelemetryProvider enabled host="localhost" port={8090}>
        {children}
      </SitrepTelemetryProvider>
    </QueryClientProvider>
  );
}

describe("useUplinkGap — hook wiring", () => {
  it("stays loading until the roster and the hub registry both resolve, then joins them", async () => {
    server.use(
      http.get("*/uplinks/registry.local.json", () =>
        HttpResponse.json({
          uplinks: [
            {
              id: "widget-a",
              name: "Widget A",
              author: "tester",
              repo: "example/repo",
              versions: [],
            },
          ],
        }),
      ),
    );
    const serverClients: Array<{ send: (data: string) => void }> = [];
    server.use(
      link.addEventListener("connection", ({ client }) => {
        serverClients.push(
          client as unknown as { send: (data: string) => void },
        );
      }),
    );

    const { result } = renderHook(() => useUplinkGap(), { wrapper });
    expect(result.current.loading).toBe(true);

    await waitFor(() => expect(serverClients).toHaveLength(1));
    serverClients[0].send(
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

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBeNull();
    expect(result.current.entries).toEqual([
      expect.objectContaining({ id: "widget-a", state: "load-from-hub" }),
    ]);
  });

  it("surfaces a hub registry fetch failure in error without conflating the entry into installed-no-client", async () => {
    server.use(
      http.get("*/uplinks/registry.local.json", () => HttpResponse.error()),
    );
    const serverClients: Array<{ send: (data: string) => void }> = [];
    server.use(
      link.addEventListener("connection", ({ client }) => {
        serverClients.push(
          client as unknown as { send: (data: string) => void },
        );
      }),
    );

    const { result } = renderHook(() => useUplinkGap(), { wrapper });

    await waitFor(() => expect(serverClients).toHaveLength(1));
    serverClients[0].send(
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

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).not.toBeNull();
    expect(
      result.current.entries.find((entry) => entry.id === "widget-a")?.state,
    ).toBe("hub-unknown");
  });

  it("reflects an id already recorded 'loaded' in loaderState through the real subscription", async () => {
    setUplinkOutcome({ id: "widget-a", name: "Widget A", status: "loaded" });
    server.use(
      http.get("*/uplinks/registry.local.json", () =>
        HttpResponse.json({ uplinks: [] }),
      ),
    );

    const { result } = renderHook(() => useUplinkGap(), { wrapper });

    await waitFor(() =>
      expect(
        result.current.entries.find((entry) => entry.id === "widget-a"),
      ).toBeDefined(),
    );
    expect(
      result.current.entries.find((entry) => entry.id === "widget-a")?.state,
    ).toBe("loaded");
  });
});
