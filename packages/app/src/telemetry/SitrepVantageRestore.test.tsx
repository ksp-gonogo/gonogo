import { clearRegistry } from "@ksp-gonogo/core";
import { useTelemetryClientOptional } from "@ksp-gonogo/sitrep-client";
import { act, render, screen, waitFor } from "@ksp-gonogo/test-utils";
import { ws } from "msw";
import { setupServer } from "msw/node";
import { useEffect } from "react";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { VantageControl } from "../components/VantageControl";
import type { LinkClient } from "../test/peerFakes";
import { SitrepTelemetryProvider } from "./SitrepTelemetryProvider";

const link = ws.link("ws://localhost:8090");
const server = setupServer();

beforeAll(() => server.listen());
afterEach(() => {
  server.resetHandlers();
  clearRegistry();
});
afterAll(() => server.close());

const CENTRE = "vessel:99e5b184-0000-0000-0000-000000000000";

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
      vantage: "meta",
      quality: 0,
      active: false,
      staleness: 0,
      timelineEpoch: 0,
    },
  });
}

function Seat() {
  const client = useTelemetryClientOptional();
  useEffect(() => client?.setVantage(CENTRE), [client]);
  return null;
}

describe("a restarted game that refuses the screen's vantage while it loads", () => {
  it("sends the vantage again, once, when the roster lists the centre", async () => {
    const sockets: LinkClient[] = [];
    const sent: Array<{ type: string; centreId?: string }> = [];
    server.use(
      link.addEventListener("connection", ({ client }) => {
        sockets.push(client);
        client.addEventListener("message", (event) => {
          sent.push(JSON.parse(String(event.data)));
        });
      }),
    );
    const vantageSends = () => sent.filter((m) => m.type === "set-vantage");

    render(
      <SitrepTelemetryProvider enabled host="localhost" port={8090}>
        <Seat />
        <VantageControl />
      </SitrepTelemetryProvider>,
    );
    await waitFor(() => expect(sockets).toHaveLength(1));
    await waitFor(() => expect(vantageSends().length).toBeGreaterThan(0));

    // The game is killed and comes back while still loading: the socket reopens before any crewed centre exists.
    await act(async () => {
      sockets[0].close();
    });
    await waitFor(() => expect(sockets).toHaveLength(2), { timeout: 15_000 });
    await waitFor(() =>
      expect(
        sent.filter((m) => m.type === "set-vantage").length,
      ).toBeGreaterThan(1),
    );
    sockets[1].send(
      JSON.stringify({
        type: "error",
        code: "unknownVantage",
        message: `'${CENTRE}' is not an active command centre`,
      }),
    );

    // Nothing the operator reads names the raw id while the centre is not seated.
    expect(
      await screen.findByRole("button", { name: /Command centre vantage/ }),
    ).not.toHaveAccessibleName(new RegExp(CENTRE));

    const before = vantageSends().length;
    await act(async () => {
      sockets[1].send(
        frame("commandCentre.roster", [
          { id: CENTRE, displayName: "Sally-Hut 1", active: true },
        ]),
      );
    });
    await waitFor(() => expect(vantageSends()).toHaveLength(before + 1));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 300));
    });
    expect(vantageSends()).toHaveLength(before + 1);
    expect(vantageSends().at(-1)?.centreId).toBe(CENTRE);
  }, 30_000);
});
