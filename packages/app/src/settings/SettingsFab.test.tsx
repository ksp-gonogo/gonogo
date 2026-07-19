import { ScreenProvider } from "@ksp-gonogo/core";
import { SerialDeviceProvider, SerialDeviceService } from "@ksp-gonogo/serial";
import { render, screen, waitFor } from "@ksp-gonogo/test-utils";
import { ModalProvider } from "@ksp-gonogo/ui";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { HttpResponse, http, ws } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { SitrepTelemetryProvider } from "../telemetry/SitrepTelemetryProvider";
import { SettingsProvider } from "./SettingsContext";
import { SettingsFab } from "./SettingsFab";
import { SettingsService } from "./SettingsService";

/**
 * Proves the aggregate "something needs attention" badge (design §1: "a
 * persistent 'Uplink Hub' affordance that carries an attention badge when
 * the cross-reference finds an installed-but-unloaded Uplink with a Hub
 * entry" — deferred by Task C to this task) — real `useUplinkGap` over a
 * live `system.uplinks` WS stream + an MSW-intercepted registry fetch, same
 * boundary `UplinkHubWizard.test.tsx`/`SettingsModal.test.tsx`'s Uplink Hub
 * describe block already use.
 */

const SITREP_URL = "ws://localhost:8090";
const link = ws.link(SITREP_URL);
const server = setupServer();

beforeAll(() => server.listen({ onUnhandledRequest: "bypass" }));
afterEach(() => server.resetHandlers());
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

function memoryStorage(): Storage {
  const m = new Map<string, string>();
  return {
    length: m.size,
    clear: () => m.clear(),
    key: () => null,
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
  } as Storage;
}

function serveRegistry(body: Record<string, unknown>) {
  server.use(
    http.get("*/uplinks/registry.local.json", () => HttpResponse.json(body)),
  );
}

function renderFab(screen_: "main" | "station" = "main") {
  const settingsService = new SettingsService(memoryStorage());
  const serialService = new SerialDeviceService({ screenKey: "test" });
  const queryClient = new QueryClient();
  const wsClients: Array<{ send: (data: string) => void }> = [];
  server.use(
    link.addEventListener("connection", ({ client }) => {
      wsClients.push(client as unknown as { send: (data: string) => void });
    }),
  );
  const result = render(
    <QueryClientProvider client={queryClient}>
      <SitrepTelemetryProvider enabled host="localhost" port={8090}>
        <ModalProvider>
          <ScreenProvider value={screen_}>
            <SettingsProvider service={settingsService}>
              <SerialDeviceProvider service={serialService}>
                <SettingsFab />
              </SerialDeviceProvider>
            </SettingsProvider>
          </ScreenProvider>
        </ModalProvider>
      </SitrepTelemetryProvider>
    </QueryClientProvider>,
  );
  return { ...result, wsClients };
}

async function emitRoster(
  wsClients: Array<{ send: (data: string) => void }>,
  uplinks: unknown[],
) {
  await waitFor(() => expect(wsClients).toHaveLength(1));
  wsClients[0]?.send(streamFrame("system.uplinks", { uplinks }));
}

describe("SettingsFab — Uplink Hub attention badge", () => {
  it("stays plain 'Settings' with nothing installed", async () => {
    serveRegistry({ uplinks: [] });
    renderFab("main");
    expect(
      await screen.findByRole("button", { name: "Settings" }),
    ).toBeInTheDocument();
  });

  it("badges the FAB on the main screen when an installed Uplink has a Hub entry and isn't loaded", async () => {
    serveRegistry({
      uplinks: [
        {
          id: "widget-hub",
          name: "Hub Widget",
          author: "tester",
          repo: "example/repo",
          versions: [
            {
              version: "1.0.0",
              minAppVersion: "1.0.0",
              apiVersion: "1.0.0",
              uiKitVersion: "1.0.0",
              contractMajor: 1,
              bundleUrl: "/uplinks/widget-hub.client.js",
              integrity: "sha256-fake",
            },
          ],
        },
      ],
    });
    const { wsClients } = renderFab("main");
    await emitRoster(wsClients, [
      {
        id: "widget-hub",
        version: "1.0.0",
        available: true,
        reason: null,
        health: { state: 0, detail: null },
      },
    ]);

    expect(
      await screen.findByRole("button", {
        name: "Settings (something needs attention)",
      }),
    ).toBeInTheDocument();
  });

  it("does NOT badge the FAB on the station screen for the same gap (main-only action)", async () => {
    serveRegistry({
      uplinks: [
        {
          id: "widget-hub",
          name: "Hub Widget",
          author: "tester",
          repo: "example/repo",
          versions: [
            {
              version: "1.0.0",
              minAppVersion: "1.0.0",
              apiVersion: "1.0.0",
              uiKitVersion: "1.0.0",
              contractMajor: 1,
              bundleUrl: "/uplinks/widget-hub.client.js",
              integrity: "sha256-fake",
            },
          ],
        },
      ],
    });
    renderFab("station");
    // No WS roster is even relevant here — `useUplinkGap`'s result is gated
    // out by `screen === "main"` before it can badge the FAB.
    expect(
      await screen.findByRole("button", { name: "Settings" }),
    ).toBeInTheDocument();
  });
});
