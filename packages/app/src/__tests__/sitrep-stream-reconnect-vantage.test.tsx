import { clearRegistry } from "@ksp-gonogo/core";
import {
  useObservedVantage,
  useSelectedVantage,
  useTelemetryClientOptional,
} from "@ksp-gonogo/sitrep-client";
import { act, render, screen, waitFor } from "@ksp-gonogo/test-utils";
import { ws } from "msw";
import { setupServer } from "msw/node";
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
 * A screen seated at a chosen command centre across a drop: the new game
 * process starts every connection at its default, so the choice has to be sent
 * again and the screen has to go on naming it.
 */

const CRAFT = "vessel:abc-123";
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

function frame(vantage: string) {
  return JSON.stringify({
    type: "stream-data",
    topic: "vessel.control",
    payload: { throttle: 0.5 },
    meta: {
      source: "test",
      validAt: 1000,
      seq: 0,
      deliveredAt: 1000,
      vantage,
      quality: 0,
      active: false,
      staleness: 0,
      timelineEpoch: 0,
    },
  });
}

function Seat() {
  const client = useTelemetryClientOptional();
  const chosen = useSelectedVantage();
  const observed = useObservedVantage();
  return (
    <div>
      <button type="button" onClick={() => client?.setVantage(CRAFT)}>
        choose
      </button>
      <div>chosen:{chosen ?? "none"}</div>
      <div>observed:{observed ?? "none"}</div>
    </div>
  );
}

interface Connection {
  client: LinkClient;
  received: string[];
}

describe("a chosen vantage across a reconnect", () => {
  it("is sent again on the new connection, ahead of the subscriptions, and is still the one the screen names", async () => {
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
    render(
      <SitrepTelemetryProvider enabled host="localhost" port={8090}>
        <Seat />
      </SitrepTelemetryProvider>,
    );
    await waitFor(() => expect(connections).toHaveLength(1));
    await waitFor(() => expect(getSitrepTransportStatus()).toBe("connected"));

    await act(async () => {
      screen.getByRole("button", { name: "choose" }).click();
    });
    expect(screen.getByText(`chosen:${CRAFT}`)).toBeTruthy();
    expect(connections[0].received.join("")).toContain("set-vantage");

    await act(async () => {
      connections[0].client.close();
    });
    await waitFor(() => expect(connections).toHaveLength(2), {
      timeout: 10_000,
    });
    await waitFor(() => expect(getSitrepTransportStatus()).toBe("connected"));

    await waitFor(() =>
      expect(connections[1].received.join("")).toContain(CRAFT),
    );
    expect(screen.getByText(`chosen:${CRAFT}`)).toBeTruthy();

    await act(async () => {
      connections[1].client.send(frame(CRAFT));
    });
    expect(await screen.findByText(`observed:${CRAFT}`)).toBeTruthy();
    expect(screen.getByText(`chosen:${CRAFT}`)).toBeTruthy();
    await act(async () => {});
  });

  it("is sent again to a NEW game process, whose rebuilt client starts with no choice of its own", async () => {
    const connections: Connection[] = [];
    server.use(
      link.addEventListener("connection", ({ client }) => {
        client.send(
          JSON.stringify({
            type: "hello",
            bootId: `boot-${connections.length}`,
          }),
        );
        const received: string[] = [];
        client.addEventListener("message", (event) =>
          received.push(String(event.data)),
        );
        connections.push({ client, received });
      }),
    );
    render(
      <SitrepTelemetryProvider enabled host="localhost" port={8090}>
        <Seat />
      </SitrepTelemetryProvider>,
    );
    await waitFor(() => expect(connections).toHaveLength(1));
    await waitFor(() => expect(getSitrepTransportStatus()).toBe("connected"));
    await act(async () => {
      screen.getByRole("button", { name: "choose" }).click();
    });
    expect(screen.getByText(`chosen:${CRAFT}`)).toBeTruthy();

    await act(async () => {
      connections[0].client.close();
    });
    await waitFor(() => expect(connections).toHaveLength(2), {
      timeout: 10_000,
    });
    await waitFor(() => expect(getSitrepTransportStatus()).toBe("connected"));

    await waitFor(() =>
      expect(connections[1].received.join("")).toContain("set-vantage"),
    );
    expect(connections[1].received.join("")).toContain(CRAFT);
    expect(screen.getByText(`chosen:${CRAFT}`)).toBeTruthy();
    await act(async () => {});
  });
});
