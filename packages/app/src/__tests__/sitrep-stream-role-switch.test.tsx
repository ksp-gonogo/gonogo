import { clearRegistry, useTelemetry } from "@ksp-gonogo/core";
import {
  useSelectedVantage,
  useTelemetryClientOptional,
  useTelemetryStoreOptional,
} from "@ksp-gonogo/sitrep-client";
import { act, render, screen, waitFor } from "@ksp-gonogo/test-utils";
import { ws } from "msw";
import { setupServer } from "msw/node";
import { useState } from "react";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { SitrepTelemetryProvider } from "../telemetry/SitrepTelemetryProvider";
import {
  getSitrepTransportStatus,
  resetSitrepRuntimeForTests,
} from "../telemetry/sitrepRuntime";
import type { LinkClient } from "../test/peerFakes";

/**
 * A page that opens as a station, and turns into the host when the one it was
 * waiting on never answers. The screen swaps one tree for the other, so the
 * stream provider, its client, store and view clock are all built again, over
 * a new socket to the game. The new clock has to go on following the stream,
 * and the command centre the screen chose has to survive the swap.
 */

const CENTRE = "centre:mesa-south";
const link = ws.link("ws://localhost:8090");
const server = setupServer();

beforeAll(() => server.listen());
afterEach(() => {
  server.resetHandlers();
  clearRegistry();
  resetSitrepRuntimeForTests();
  vi.useRealTimers();
});
afterAll(() => server.close());

function frame(validAt: number, vantage = "test") {
  return JSON.stringify({
    type: "stream-data",
    topic: "vessel.control",
    payload: { sas: true, rcs: false },
    meta: {
      source: "test",
      validAt,
      seq: validAt,
      deliveredAt: validAt,
      vantage,
      quality: 0,
      active: false,
      staleness: 0,
      timelineEpoch: 1,
    },
  });
}

function Seat() {
  const client = useTelemetryClientOptional();
  const store = useTelemetryStoreOptional();
  const chosen = useSelectedVantage();
  const control = useTelemetry("vessel.control");
  const newest = store ? store.clock.snapshot().maxSampleUt : "none";
  return (
    <div>
      <button type="button" onClick={() => client?.setVantage(CENTRE)}>
        choose
      </button>
      <span>chosen:{chosen ?? "none"}</span>
      <span>newest:{newest}</span>
      <span>state:{control.state}</span>
    </div>
  );
}

function Page() {
  const [hosting, setHosting] = useState(false);
  return (
    <div>
      <button type="button" onClick={() => setHosting(true)}>
        become host
      </button>
      {hosting ? (
        <div key="hosting">
          <SitrepTelemetryProvider enabled host="localhost" port={8090}>
            <Seat />
          </SitrepTelemetryProvider>
        </div>
      ) : (
        <div key="joined">
          <SitrepTelemetryProvider enabled host="localhost" port={8090}>
            <Seat />
          </SitrepTelemetryProvider>
        </div>
      )}
    </div>
  );
}

interface Connection {
  client: LinkClient;
  received: string[];
}

describe("the stream after a station turns into the host", () => {
  async function switchOver() {
    const connections: Connection[] = [];
    server.use(
      link.addEventListener("connection", ({ client }) => {
        const received: string[] = [];
        client.addEventListener("message", (event) =>
          received.push(String(event.data)),
        );
        connections.push({ client, received });
      }),
    );
    render(<Page />);
    await waitFor(() => expect(connections).toHaveLength(1));
    await waitFor(() => expect(getSitrepTransportStatus()).toBe("connected"));
    await act(async () => {
      screen.getByRole("button", { name: "choose" }).click();
    });
    await act(async () => {
      connections[0].client.send(frame(100));
    });
    expect(await screen.findByText("newest:100")).toBeTruthy();

    await act(async () => {
      screen.getByRole("button", { name: "become host" }).click();
    });
    await waitFor(() => expect(connections).toHaveLength(2));
    await waitFor(() => expect(getSitrepTransportStatus()).toBe("connected"));
    return connections;
  }

  it("asks the new connection for the topics the screen reads", async () => {
    const connections = await switchOver();
    await waitFor(() =>
      expect(connections[1].received.join("")).toContain("vessel.control"),
    );
    await act(async () => {});
  });

  it("keeps the command centre the screen chose", async () => {
    const connections = await switchOver();
    await waitFor(() =>
      expect(connections[1].received.join("")).toContain("set-vantage"),
    );
    expect(connections[1].received.join("")).toContain(CENTRE);
    expect(screen.getByText(`chosen:${CENTRE}`)).toBeTruthy();
    await act(async () => {});
  });

  it("keeps moving the new clock's newest sample as the stream goes on", async () => {
    const connections = await switchOver();
    for (const ut of [101, 102, 103]) {
      await act(async () => {
        connections[1].client.send(frame(ut));
      });
    }
    expect(await screen.findByText("newest:103")).toBeTruthy();
    await act(async () => {});
  });
});
