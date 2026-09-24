import { clearRegistry, useTelemetry } from "@ksp-gonogo/core";
import { sampleActiveTopic } from "@ksp-gonogo/sitrep-client";
import { act, render, screen, waitFor } from "@ksp-gonogo/test-utils";
import { ws } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { SitrepTelemetryProvider } from "../telemetry/SitrepTelemetryProvider";
import type { LinkClient } from "../test/peerFakes";

/**
 * What a passive read (`sampleActiveTopic`, and every `get*` accessor built on
 * it) returns for a topic once the last thing holding it has let go.
 *
 * Releasing a topic clears the client's sticky value and sends `unsubscribe`,
 * but nothing removes the topic's timeline from the store, and a store read is
 * hold-last. So the answer is the LAST payload, and it stays that way however
 * far the view time moves on: only an epoch change (a quickload) or a new store
 * clears it. A headless caller reading such a topic acts on a reading taken
 * whenever the holder unmounted.
 *
 * The epoch case is here to prove the harness can report the other answer: a
 * test that could only ever observe a frozen value would say nothing.
 */

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
  timelineEpoch = 0,
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

/** A widget holding `vessel.control` for as long as it is mounted. */
function Holder() {
  const control = useTelemetry("vessel.control");
  return (
    <div>held:{control.state === "observed" ? "observed" : control.state}</div>
  );
}

function Tree({ holding }: { holding: boolean }) {
  return (
    <SitrepTelemetryProvider
      enabled
      host="localhost"
      port={8090}
      carriedChannels={["vessel.control", "comms.delay"]}
    >
      {holding && <Holder />}
    </SitrepTelemetryProvider>
  );
}

const CONTROL = { sas: true, rcs: false };

/**
 * Mounts the tree with the holder, serves one `vessel.control` reading, then
 * unmounts the holder alone and waits until the unsubscribe reaches the wire.
 */
async function holdThenRelease() {
  const clients: LinkClient[] = [];
  const received: Array<{ type?: string; topic?: string }> = [];
  server.use(
    link.addEventListener("connection", ({ client }) => {
      clients.push(client);
      client.addEventListener("message", (event) => {
        received.push(JSON.parse(String(event.data)));
      });
    }),
  );
  const view = render(<Tree holding />);
  await waitFor(() => expect(clients).toHaveLength(1));
  await waitFor(() =>
    expect(received).toContainEqual({
      type: "subscribe",
      topic: "vessel.control",
    }),
  );
  clients[0].send(frame("vessel.control", CONTROL, 10));
  expect(await screen.findByText("held:observed")).toBeTruthy();

  view.rerender(<Tree holding={false} />);
  await waitFor(() =>
    expect(received).toContainEqual({
      type: "unsubscribe",
      topic: "vessel.control",
    }),
  );
  return { view, send: (message: string) => clients[0].send(message) };
}

describe("a passive read after the last holder lets go", () => {
  it("reads nothing before anything has held the topic", async () => {
    const view = render(<Tree holding={false} />);
    await act(async () => {});
    expect(sampleActiveTopic("vessel.control")).toBeUndefined();
    view.unmount();
  });

  it("keeps returning the last payload, however far the view time moves on", async () => {
    const { view, send } = await holdThenRelease();

    // Other traffic keeps arriving and carries the view hours past the
    // reading, so the store mints fresh frames the whole time.
    for (const validAt of [20, 600, 36_000]) {
      await act(async () => {
        send(
          frame(
            "comms.delay",
            { oneWaySeconds: null, source: "None" },
            validAt,
          ),
        );
      });
    }
    await act(async () => {});

    expect(sampleActiveTopic("vessel.control")).toEqual(CONTROL);
    view.unmount();
  });

  it("reads nothing once the epoch moves on, so the harness can see the other answer", async () => {
    const { view, send } = await holdThenRelease();

    await act(async () => {
      send(
        frame("comms.delay", { oneWaySeconds: null, source: "None" }, 20, 1),
      );
    });
    await act(async () => {});

    expect(sampleActiveTopic("vessel.control")).toBeUndefined();
    view.unmount();
  });
});
