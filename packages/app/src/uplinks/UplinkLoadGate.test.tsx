import { clearRegistry } from "@ksp-gonogo/core";
import { act, render, screen, waitFor } from "@ksp-gonogo/test-utils";
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
  vi,
} from "vitest";
import { SitrepTelemetryProvider } from "../telemetry/SitrepTelemetryProvider";
import type { LinkClient } from "../test/peerFakes";
import { __resetUplinkOutcomes, setUplinkOutcome } from "./loaderState";
import { UplinkLoadGate } from "./UplinkLoadGate";

const link = ws.link("ws://localhost:8090");
const server = setupServer();

beforeAll(() => server.listen({ onUnhandledRequest: "bypass" }));
beforeEach(() => {
  __resetUplinkOutcomes();
  clearRegistry();
});
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function frame(topic: string, payload: unknown): string {
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

const row = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  version: "1.0.0",
  available: true,
  reason: null,
  expectedClientHash: "client-hash",
  author: "Test Author",
  repo: "example/addon",
  health: { state: 0, detail: null },
  ...extra,
});

const healthRow = (id: string, extra: Record<string, unknown> = {}) => ({
  ...row(id),
  name: id,
  contract: null,
  ownedPrefixes: [],
  modSettings: false,
  bundled: false,
  health: { state: "healthy", detail: null, facts: [] },
  ...extra,
});

async function mount(host = { setUplinkFailures: vi.fn() }) {
  const clients: LinkClient[] = [];
  server.use(
    link.addEventListener("connection", ({ client }) => {
      clients.push(client);
    }),
  );
  render(
    <UplinkLoadGate host={host}>
      <div>dashboard</div>
    </UplinkLoadGate>,
    { wrapper },
  );
  await waitFor(() => expect(clients).toHaveLength(1));
  return {
    host,
    send: (
      uplinks: ReturnType<typeof row>[],
      health: ReturnType<typeof healthRow>[],
    ) => {
      clients[0].send(frame("system.uplinks", { uplinks }));
      clients[0].send(
        frame("system.uplinkHealth", {
          coreContractMajor: 15,
          coreContractMinor: 0,
          uplinks: health,
        }),
      );
    },
  };
}

describe("UplinkLoadGate", () => {
  it("opens the dashboard while nothing has failed", async () => {
    const { send } = await mount();
    send([row("widget-a")], [healthRow("widget-a")]);
    await act(async () => {
      setUplinkOutcome({ id: "widget-a", name: "Widget A", status: "loaded" });
    });
    expect(await screen.findByText("dashboard")).toBeInTheDocument();
  });

  it("replaces the dashboard with the failure screen for a quarantined client, and tells stations", async () => {
    const { send, host } = await mount();
    send([row("widget-a")], [healthRow("widget-a")]);
    await act(async () => {
      setUplinkOutcome({
        id: "widget-a",
        name: "Widget A",
        status: "quarantined",
        reason: "bundle fetch failed: HTTP 404",
      });
    });
    expect(
      await screen.findByRole("heading", {
        name: /1 installed Uplink failed to load/,
      }),
    ).toBeInTheDocument();
    expect(screen.getByText(/HTTP 404/)).toBeInTheDocument();
    expect(screen.queryByText("dashboard")).not.toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(host.setUplinkFailures).toHaveBeenLastCalledWith([
      { id: "widget-a", name: "Widget A" },
    ]);
  });

  it("clears when the Uplink loads after a reconnect", async () => {
    const { send, host } = await mount();
    send([row("widget-a")], [healthRow("widget-a")]);
    await act(async () => {
      setUplinkOutcome({
        id: "widget-a",
        name: "Widget A",
        status: "quarantined",
        reason: "load failed: boom",
      });
    });
    await screen.findByRole("heading", { name: /failed to load/ });
    await act(async () => {
      setUplinkOutcome({ id: "widget-a", name: "Widget A", status: "loaded" });
    });
    expect(await screen.findByText("dashboard")).toBeInTheDocument();
    expect(host.setUplinkFailures).toHaveBeenLastCalledWith([]);
  });

  it("refuses an Uplink the mod itself could not start", async () => {
    const { send } = await mount();
    send(
      [row("widget-a", { available: false, reason: "missing Foo" })],
      [healthRow("widget-a", { available: false, reason: "missing Foo" })],
    );
    expect(await screen.findByText(/missing Foo/)).toBeInTheDocument();
  });

  it("stays open for a bundled Uplink whose expansion is not owned", async () => {
    const { send } = await mount();
    send(
      [row("bundled-a", { bundled: true })],
      [
        healthRow("bundled-a", {
          bundled: true,
          health: { state: "unavailable", detail: "DLC absent", facts: [] },
        }),
      ],
    );
    expect(await screen.findByText("dashboard")).toBeInTheDocument();
    await act(async () => {});
  });
});
