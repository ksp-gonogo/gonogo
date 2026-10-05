import { clearRegistry, useTelemetry } from "@ksp-gonogo/core";
import {
  act,
  probeText,
  render,
  screen,
  waitFor,
} from "@ksp-gonogo/test-utils";
import { NULL_DISPLAY } from "@ksp-gonogo/ui-kit";
import { expectNoA11yViolations } from "@ksp-gonogo/ui-kit/testing";
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
 * A page left open across a game restart: the stream goes quiet (with or
 * without a close), a new server answers, and the widget must recover without
 * a reload. The new server's frames carry an older timeline epoch and clock,
 * as a restarted mod's do.
 */

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

function throttleFrame(throttle: number, epoch: number, validAt: number) {
  return JSON.stringify({
    type: "stream-data",
    topic: "vessel.control",
    payload: { throttle },
    meta: {
      source: "test",
      validAt,
      seq: 0,
      deliveredAt: validAt,
      vantage: "test",
      quality: 0,
      active: false,
      staleness: 0,
      timelineEpoch: epoch,
    },
  });
}

function Throttle() {
  const reading = useTelemetry("vessel.control");
  const throttle =
    reading.state === "observed" ? reading.value.throttle : undefined;
  return (
    <div>throttle:{throttle == null ? NULL_DISPLAY : probeText(throttle)}</div>
  );
}

interface Connection {
  client: LinkClient;
  received: string[];
}

function track(connections: Connection[]) {
  return link.addEventListener("connection", ({ client }) => {
    const received: string[] = [];
    client.addEventListener("message", (event) =>
      received.push(String(event.data)),
    );
    connections.push({ client, received });
  });
}

async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

async function mountAndReceiveFirstGame(connections: Connection[]) {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  server.use(track(connections));
  const view = render(
    <SitrepTelemetryProvider enabled host="localhost" port={8090}>
      <Throttle />
    </SitrepTelemetryProvider>,
  );
  await waitFor(() => expect(connections).toHaveLength(1));
  await waitFor(() => expect(getSitrepTransportStatus()).toBe("connected"));
  await act(async () => {
    connections[0].client.send(throttleFrame(0.75, 5, 1000));
  });
  expect(await screen.findByText("throttle:0.75")).toBeTruthy();
  return view;
}

describe("Sitrep stream recovers across a game restart without a reload", () => {
  it("a socket that goes silent without closing is replaced and the new game's frames are shown", async () => {
    const connections: Connection[] = [];
    const { container } = await mountAndReceiveFirstGame(connections);

    await advance(36_000);
    expect(getSitrepTransportStatus()).toBe("reconnecting");
    expect(screen.getByText("throttle:0.75")).toBeTruthy();

    await advance(5_000);
    await waitFor(() => expect(connections).toHaveLength(2));
    await waitFor(() => expect(getSitrepTransportStatus()).toBe("connected"));
    await waitFor(() =>
      expect(connections[1].received.join("")).toContain("vessel.control"),
    );
    expect(screen.getByText(`throttle:${NULL_DISPLAY}`)).toBeTruthy();

    await act(async () => {
      connections[1].client.send(throttleFrame(0.25, 0, 10));
    });
    expect(await screen.findByText("throttle:0.25")).toBeTruthy();
    await expectNoA11yViolations(container);
  });

  it("an idle but healthy server for 90 seconds causes no reconnect and keeps what the page holds", async () => {
    const connections: Connection[] = [];
    const { container } = await mountAndReceiveFirstGame(connections);
    // A server that has nothing to publish still answers the transport's liveness probe, as the mod does with an unknownTopic error.
    connections[0].client.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data));
      if (message.topic !== "liveness.probe") return;
      connections[0].client.send(
        JSON.stringify({
          type: "error",
          topic: "liveness.probe",
          code: "unknownTopic",
          message: "no channel is declared",
        }),
      );
    });

    for (let i = 0; i < 9; i++) await advance(10_000);

    expect(connections).toHaveLength(1);
    expect(getSitrepTransportStatus()).toBe("connected");
    expect(screen.getByText("throttle:0.75")).toBeTruthy();
    await expectNoA11yViolations(container);
  });

  it("a plain close and reopen shows the new game's frames", async () => {
    const connections: Connection[] = [];
    const { container } = await mountAndReceiveFirstGame(connections);

    await act(async () => {
      connections[0].client.close();
    });
    await advance(5_000);
    await waitFor(() => expect(connections).toHaveLength(2));
    await waitFor(() => expect(getSitrepTransportStatus()).toBe("connected"));
    await waitFor(() =>
      expect(connections[1].received.join("")).toContain("vessel.control"),
    );

    await act(async () => {
      connections[1].client.send(throttleFrame(0.25, 0, 10));
    });
    expect(await screen.findByText("throttle:0.25")).toBeTruthy();
    await expectNoA11yViolations(container);
  });
});
