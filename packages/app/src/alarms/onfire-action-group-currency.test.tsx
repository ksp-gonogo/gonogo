import { clearRegistry, useTelemetry } from "@ksp-gonogo/core";
import { memoryStorage } from "@ksp-gonogo/core/test";
import { act, render, screen, waitFor } from "@ksp-gonogo/test-utils";
import { ws } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { SitrepTelemetryProvider } from "../telemetry/SitrepTelemetryProvider";
import { AlarmHostService } from "./AlarmHostService";

/**
 * What an alarm's `onFire` action group does when the `vessel.control` reading
 * behind it is no longer current.
 *
 * A toggle is sent as an ABSOLUTE set of the inverse (the contract has no
 * relative form for any of these commands), so the dispatch has to invert a
 * state it just read. The store is hold-last and never drops a released
 * topic's timeline, so the payload the alarm used to read stayed frozen at
 * whatever the last holder saw: the operator configures the alarm in the modal,
 * the modal's `useActionGroups` is the only thing subscribed to
 * `vessel.control`, and closing it freezes the reading. Move the gear by hand
 * after that and the alarm's "toggle gear" sends the state it is already in.
 *
 * The reading now carries its own currency, so the dispatch can see that the
 * value is `stale` and refuse instead of inverting it. Both answers are pinned
 * here over one real provider and one real socket, separated by nothing but
 * whether `vessel.control` kept arriving.
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

/** The modal's action-group registry, in the one thing that holds it open. */
function Holder() {
  const control = useTelemetry("vessel.control");
  return <div>held:{control.state}</div>;
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

const CONTROL = {
  gear: false,
  actionGroups: [{ index: 1, name: "AG1", state: false }],
};

const DELAY = { oneWaySeconds: null, source: "None" };

interface WireMessage {
  type?: string;
  topic?: string;
  command?: string;
  args?: { group?: number; state?: boolean };
}

/**
 * The tree, the socket, and the first `vessel.control` reading, with the
 * holder mounted. Returns the wire log and a sender, so each test decides for
 * itself what keeps arriving afterwards.
 */
async function mountWithControl() {
  const clients: Array<{ send: (data: string) => void }> = [];
  const received: WireMessage[] = [];
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
    expect(received).toContainEqual(
      expect.objectContaining({
        type: "subscribe",
        topic: "vessel.control",
      }),
    ),
  );
  await act(async () => {
    clients[0].send(frame("vessel.control", CONTROL, 10));
  });
  expect(await screen.findByText("held:observed")).toBeTruthy();
  return {
    view,
    received,
    send: (message: string) => clients[0].send(message),
  };
}

/**
 * An alarm host with one time alarm due at UT 400, whose `onFire` toggles AG1.
 * Ticks fast, because a test that has to wait out a 1 Hz loop to see a
 * dispatch is a test that spends its life in `waitFor`.
 */
function hostWithAlarm(): AlarmHostService {
  const svc = new AlarmHostService(null, {
    storage: memoryStorage(),
    tickIntervalMs: 20,
  });
  svc.addAlarm({
    name: "Gear down",
    trigger: { kind: "time", ut: 400, leadSeconds: 0 },
    onFire: [{ kind: "action-group", action: "AG1" }],
  });
  return svc;
}

function actionGroupCommands(received: readonly WireMessage[]) {
  return received.filter(
    (m) =>
      m.type === "command-request" &&
      m.command === "vessel.control.setActionGroup",
  );
}

describe("an alarm's onFire action group and the currency of what it inverts", () => {
  it("inverts the group while vessel.control is still arriving", async () => {
    const { view, received, send } = await mountWithControl();
    const svc = hostWithAlarm();

    /* The clock crosses the alarm's instant, and `vessel.control` keeps its
       keyframe cadence across the crossing: the reading at fire time is this
       frame's, not the one the mount served. */
    await act(async () => {
      send(frame("comms.delay", DELAY, 600));
      send(frame("vessel.control", CONTROL, 600));
    });
    await waitFor(() => expect(actionGroupCommands(received)).toHaveLength(1));

    expect(actionGroupCommands(received)[0].args).toEqual({
      group: 1,
      state: true,
    });
    expect(svc.snapshot().onFireRefusals).toBeUndefined();
    svc.dispose();
    view.unmount();
  });

  it("refuses the toggle, and says so on the alarm, once the last holder has let go", async () => {
    const { view, received, send } = await mountWithControl();

    /* The modal closes. The client unsubscribes on the wire, and from here
       nothing on this screen reads `vessel.control` at all. */
    view.rerender(<Tree holding={false} />);
    await waitFor(() =>
      expect(received).toContainEqual(
        expect.objectContaining({
          type: "unsubscribe",
          topic: "vessel.control",
        }),
      ),
    );

    const svc = hostWithAlarm();
    await act(async () => {
      send(frame("comms.delay", DELAY, 600));
    });

    /* The alarm itself fires: the condition came due and the operator gets
       their banner. What must not happen is the action group going out with
       the state the last holder saw inverted. */
    const alarmId = svc.snapshot().alarms[0].id;
    await waitFor(() =>
      expect(svc.snapshot().alarms[0].state).not.toBe("pending"),
    );
    await act(async () => {});
    expect(actionGroupCommands(received)).toHaveLength(0);
    expect(svc.snapshot().onFireRefusals?.[alarmId]).toContain("stale");

    svc.dispose();
    view.unmount();
  });
});
