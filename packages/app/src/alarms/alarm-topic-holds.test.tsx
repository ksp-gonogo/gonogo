import { clearRegistry, useTelemetry } from "@ksp-gonogo/core";
import { memoryStorage } from "@ksp-gonogo/core/test";
import { act, render, screen, waitFor } from "@ksp-gonogo/test-utils";
import { ws } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { SitrepTelemetryProvider } from "../telemetry/SitrepTelemetryProvider";
import { AlarmHostService } from "./AlarmHostService";

/**
 * A command-vantage threshold alarm is evaluated here, off the stream, and it
 * is what stops the warp when it fires. So it has to be able to fire on a Topic
 * no widget draws, and it must never fire on a number a widget last drew.
 *
 * The socket below behaves as the mod does: it sends `vessel.flight` only while
 * somebody is subscribed to it. Nothing but the alarm host is mounted beside
 * the provider unless a test says otherwise.
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

function frame(topic: string, payload: unknown, validAt: number): string {
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
      timelineEpoch: 0,
    },
  });
}

function Holder() {
  const flight = useTelemetry("vessel.flight");
  return <div>held:{flight.state}</div>;
}

function Tree({ holding }: { holding: boolean }) {
  return (
    <SitrepTelemetryProvider
      enabled
      host="localhost"
      port={8090}
      carriedChannels={["vessel.flight", "comms.delay"]}
    >
      {holding && <Holder />}
    </SitrepTelemetryProvider>
  );
}

const DELAY = { oneWaySeconds: null, source: "None" };

interface WireMessage {
  type?: string;
  topic?: string;
  command?: string;
  args?: { index?: number };
}

/** The socket, and a sender that drops a frame for a Topic nobody is subscribed to. */
async function mount(holding: boolean) {
  const clients: Array<{ send: (data: string) => void }> = [];
  const received: WireMessage[] = [];
  const subscribed = new Map<string, number>();
  server.use(
    link.addEventListener("connection", ({ client }) => {
      clients.push(client);
      client.addEventListener("message", (event) => {
        const message: WireMessage = JSON.parse(String(event.data));
        received.push(message);
        if (!message.topic) return;
        const count = subscribed.get(message.topic) ?? 0;
        if (message.type === "subscribe") {
          subscribed.set(message.topic, count + 1);
        }
        if (message.type === "unsubscribe") {
          subscribed.set(message.topic, Math.max(0, count - 1));
        }
      });
    }),
  );
  const view = render(<Tree holding={holding} />);
  await waitFor(() => expect(clients).toHaveLength(1));
  const send = (topic: string, payload: unknown, validAt: number) => {
    if ((subscribed.get(topic) ?? 0) === 0 && topic !== "comms.delay") return;
    clients[0].send(frame(topic, payload, validAt));
  };
  return {
    view,
    received,
    send,
    isSubscribed: (topic: string) => (subscribed.get(topic) ?? 0) > 0,
  };
}

function hostWithAltitudeAlarm(): AlarmHostService {
  const svc = new AlarmHostService(null, {
    storage: memoryStorage(),
    tickIntervalMs: 20,
  });
  svc.addAlarm({
    name: "Above 70 km",
    trigger: {
      kind: "threshold",
      dataKey: "vessel.flight.altitudeAsl",
      op: ">",
      value: 70_000,
      sustainSeconds: 0,
    },
  });
  return svc;
}

function warpStops(received: readonly WireMessage[]) {
  return received.filter(
    (m) =>
      m.type === "command-request" &&
      m.command === "time.setWarpIndex" &&
      m.args?.index === 0,
  );
}

describe("a threshold alarm holds its own Topic", () => {
  it("fires, and stops the warp, on a Topic no widget is mounted for", async () => {
    const { view, received, send, isSubscribed } = await mount(false);
    const svc = hostWithAltitudeAlarm();

    await waitFor(() => expect(isSubscribed("vessel.flight")).toBe(true));
    await act(async () => {
      send("comms.delay", DELAY, 600);
      send("vessel.flight", { altitudeAsl: 80_000 }, 600);
    });

    await waitFor(() =>
      expect(svc.snapshot().alarms[0].state).not.toBe("pending"),
    );
    await waitFor(() => expect(warpStops(received).length).toBeGreaterThan(0));

    svc.dispose();
    await waitFor(() => expect(isSubscribed("vessel.flight")).toBe(false));
    view.unmount();
  });

  it("does not fire on the value a released widget last drew", async () => {
    const { view, send, isSubscribed } = await mount(true);
    await waitFor(() => expect(isSubscribed("vessel.flight")).toBe(true));
    await act(async () => {
      send("vessel.flight", { altitudeAsl: 80_000 }, 10);
    });
    expect(await screen.findByText("held:observed")).toBeTruthy();

    view.rerender(<Tree holding={false} />);
    await waitFor(() => expect(isSubscribed("vessel.flight")).toBe(false));
    await act(async () => {
      send("comms.delay", DELAY, 600);
    });

    /* The alarm is armed after the widget let go and the clock moved on. It
       takes its own hold, but nothing new has arrived on it: the only altitude
       in the store is the widget's 80 km from UT 10, above the threshold. */
    const svc = hostWithAltitudeAlarm();
    await waitFor(() => expect(isSubscribed("vessel.flight")).toBe(true));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 200));
    });
    expect(svc.snapshot().alarms[0].state).toBe("pending");

    /* A reading that is current now decides it, in either direction. */
    await act(async () => {
      send("comms.delay", DELAY, 610);
      send("vessel.flight", { altitudeAsl: 80_000 }, 610);
    });
    await waitFor(() =>
      expect(svc.snapshot().alarms[0].state).not.toBe("pending"),
    );

    svc.dispose();
    view.unmount();
  });
});
