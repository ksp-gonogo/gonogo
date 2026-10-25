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
import { useUplinkReadiness } from "../firstRun/useUplinkReadiness";
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

/* One `system.uplinks` frame carries everything: the derived `system.uplinkHealth` is worked out from it in the same step, so there is no second frame to land after the test has finished. */
const row = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  version: "1.0.0",
  available: true,
  reason: null,
  expectedClientHash: "client-hash",
  author: "Test Author",
  repo: "example/addon",
  bundled: false,
  health: { state: 0, detail: null },
  ...extra,
});

/* Shows whether the mod's roster has arrived, so a test that expects the dashboard can wait until the roster has been consumed, derived health channel included, rather than end with it still in flight. */
function Dashboard() {
  const { waitingForMod } = useUplinkReadiness();
  return (
    <>
      <div>dashboard</div>
      <output>{waitingForMod ? "roster:waiting" : "roster:read"}</output>
    </>
  );
}

/* Holds the test open across the tail of the socket's work, which lands after the last assertion otherwise. */
const settle = () => act(async () => {});

async function mount(host = { setUplinkFailures: vi.fn() }) {
  const clients: LinkClient[] = [];
  server.use(
    link.addEventListener("connection", ({ client }) => {
      clients.push(client);
    }),
  );
  render(
    <UplinkLoadGate host={host}>
      <Dashboard />
    </UplinkLoadGate>,
    { wrapper },
  );
  await waitFor(() => expect(clients).toHaveLength(1));
  return {
    host,
    send: (uplinks: ReturnType<typeof row>[]) => {
      clients[0].send(frame("system.uplinks", { uplinks }));
    },
  };
}

describe("UplinkLoadGate", () => {
  it("opens the dashboard while nothing has failed", async () => {
    const { send } = await mount();
    send([row("widget-a")]);
    await act(async () => {
      setUplinkOutcome({ id: "widget-a", name: "Widget A", status: "loaded" });
    });
    expect(await screen.findByText("roster:read")).toBeInTheDocument();
    expect(screen.getByText("dashboard")).toBeInTheDocument();
    await settle();
  });

  it("replaces the dashboard with the failure screen for a quarantined client, and tells stations", async () => {
    const { send, host } = await mount();
    send([row("widget-a")]);
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
    await settle();
  });

  it("clears when the Uplink loads after a reconnect", async () => {
    const { send, host } = await mount();
    send([row("widget-a")]);
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
    expect(await screen.findByText("roster:read")).toBeInTheDocument();
    expect(host.setUplinkFailures).toHaveBeenLastCalledWith([]);
    await settle();
  });

  it("refuses an Uplink the mod itself could not start", async () => {
    const { send } = await mount();
    send([row("widget-a", { available: false, reason: "missing Foo" })]);
    expect(await screen.findByText(/missing Foo/)).toBeInTheDocument();
    await settle();
  });

  it("stays open for a bundled Uplink whose expansion is not owned", async () => {
    const { send } = await mount();
    send([
      row("bundled-a", {
        bundled: true,
        health: { state: 2, detail: "DLC absent" },
      }),
    ]);
    expect(await screen.findByText("roster:read")).toBeInTheDocument();
    expect(screen.getByText("dashboard")).toBeInTheDocument();
    await settle();
  });
});
