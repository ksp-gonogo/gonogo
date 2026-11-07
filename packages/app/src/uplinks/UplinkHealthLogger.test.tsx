import type { LogEntry, LogTransport } from "@ksp-gonogo/logger";
import { logger } from "@ksp-gonogo/logger";
import { render, waitFor } from "@ksp-gonogo/test-utils";
import { ws } from "msw";
import { setupServer } from "msw/node";
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
import type { LinkClient } from "../test/peerFakes";
import { UplinkHealthLogger } from "./UplinkHealthLogger";

const link = ws.link("ws://localhost:8090");
const server = setupServer();

beforeAll(() => server.listen({ onUnhandledRequest: "bypass" }));
afterAll(() => server.close());

const entries: LogEntry[] = [];
const transport: LogTransport = {
  send: (batch) => {
    entries.push(...batch);
  },
};
beforeEach(() => {
  entries.length = 0;
  logger.setEnabled(true);
  logger.addTransport(transport);
});
afterEach(() => {
  logger.setEnabled(false);
  logger.removeTransport(transport);
  server.resetHandlers();
});

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

const roster = (state: number, detail: string | null) =>
  frame("system.uplinks", {
    uplinks: [
      {
        id: "widget-a",
        version: "1.0.0",
        available: state !== 2,
        reason: state === 2 ? detail : null,
        health: { state, detail },
      },
    ],
  });

const healthLines = () => entries.filter((e) => e.tag === "uplink-health");

describe("UplinkHealthLogger", () => {
  it("logs each transition once: warn for degraded, error for unavailable, info for recovery", async () => {
    const clients: LinkClient[] = [];
    server.use(
      link.addEventListener("connection", ({ client }) => {
        clients.push(client);
      }),
    );
    render(
      <SitrepTelemetryProvider enabled host="localhost" port={8090}>
        <UplinkHealthLogger />
      </SitrepTelemetryProvider>,
    );
    await waitFor(() => expect(clients).toHaveLength(1));

    clients[0].send(roster(0, null));
    clients[0].send(roster(1, "server slow"));
    await waitFor(() => expect(healthLines()).toHaveLength(1));
    expect(healthLines()[0]).toMatchObject({
      level: "warn",
      context: {
        uplinkId: "widget-a",
        from: "healthy",
        to: "degraded",
        reason: "server slow",
      },
    });

    // The same state again is not a transition.
    clients[0].send(roster(1, "server slower"));
    clients[0].send(roster(2, "server gone"));
    await waitFor(() => expect(healthLines()).toHaveLength(2));
    expect(healthLines()[1]).toMatchObject({
      level: "error",
      context: { from: "degraded", to: "unavailable", reason: "server gone" },
    });

    clients[0].send(roster(0, null));
    await waitFor(() => expect(healthLines()).toHaveLength(3));
    expect(healthLines()[2]).toMatchObject({ level: "info" });
  });
});
