import { clearRegistry, useTelemetry } from "@ksp-gonogo/core";
import { useViewClockOptional } from "@ksp-gonogo/sitrep-client";
import { act, render, screen, waitFor } from "@ksp-gonogo/test-utils";
import { ws } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { SitrepTelemetryProvider } from "../telemetry/SitrepTelemetryProvider";
import type { LinkClient } from "../test/peerFakes";

const URL = "ws://localhost:8090";
const link = ws.link(URL);
const server = setupServer();

beforeAll(() => server.listen());
afterEach(() => {
  server.resetHandlers();
  clearRegistry();
});
afterAll(() => server.close());

function frame(
  topic: string,
  payload: unknown,
  validAt: number,
  timelineEpoch: number,
): string {
  return JSON.stringify({
    type: "stream-data",
    topic,
    payload,
    meta: {
      source: "test",
      validAt,
      seq: validAt,
      deliveredAt: validAt,
      vantage: "test",
      quality: 0,
      active: false,
      staleness: 0,
      timelineEpoch,
    },
  });
}

function Probe() {
  const clock = useViewClockOptional();
  const control = useTelemetry("vessel.control");
  const ut = clock ? Math.floor(clock.viewUt()) : "none";
  return (
    <div>
      <span>ut:{ut}</span>
      <span>state:{control.state}</span>
    </div>
  );
}

async function connect() {
  const clients: LinkClient[] = [];
  server.use(
    link.addEventListener("connection", ({ client }) => {
      clients.push(client);
    }),
  );
  render(
    <SitrepTelemetryProvider enabled host="localhost" port={8090}>
      <Probe />
    </SitrepTelemetryProvider>,
  );
  await waitFor(() => expect(clients).toHaveLength(1));
  return clients[0];
}

const CONTROL = { sas: true, rcs: false };

describe("the view clock after the game's UT goes backwards", () => {
  it("follows a rewind that arrives on a new timeline epoch", async () => {
    const client = await connect();
    client.send(frame("vessel.control", CONTROL, 8319, 0));
    await waitFor(() => expect(screen.getByText("ut:8319")).toBeTruthy());
    client.send(frame("vessel.control", CONTROL, 397.7, 1));
    await waitFor(() => expect(screen.getByText("ut:397")).toBeTruthy());
    await act(async () => {});
  });

  it("follows a rewind the mod sent after a load without a new epoch", async () => {
    const client = await connect();
    client.send(frame("vessel.control", CONTROL, 8319, 0));
    await waitFor(() => expect(screen.getByText("ut:8319")).toBeTruthy());
    client.send(
      JSON.stringify({ type: "game-state", state: "loading", scene: "flight" }),
    );
    client.send(
      JSON.stringify({ type: "game-state", state: "ready", scene: "flight" }),
    );
    client.send(frame("vessel.control", CONTROL, 397.7, 0));
    await waitFor(() => expect(screen.getByText("ut:397")).toBeTruthy());
    client.send(frame("vessel.control", CONTROL, 400.2, 0));
    await waitFor(() => expect(screen.getByText("ut:400")).toBeTruthy());
    await act(async () => {});
  });

  it("still refuses an older sample inside one timeline when no load happened", async () => {
    const client = await connect();
    client.send(frame("vessel.control", CONTROL, 8319, 0));
    await waitFor(() => expect(screen.getByText("ut:8319")).toBeTruthy());
    client.send(frame("vessel.control", CONTROL, 8310, 0));
    await act(async () => {});
    expect(screen.getByText("ut:8319")).toBeTruthy();
  });
});
