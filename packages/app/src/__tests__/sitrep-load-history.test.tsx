import { clearRegistry, useTelemetry } from "@ksp-gonogo/core";
import {
  act,
  probeText,
  render,
  screen,
  waitFor,
} from "@ksp-gonogo/test-utils";
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

/**
 * A load starts a new timeline and the mod's `timeline-reset` says how much of
 * the old one survives. Everything between the socket and the widget is real;
 * only the network is intercepted.
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

function delayFrame(oneWaySeconds: number, at = 1000, epoch = 0) {
  return JSON.stringify({
    type: "stream-data",
    topic: "comms.delay",
    payload: { oneWaySeconds },
    meta: {
      source: "test",
      validAt: at,
      seq: 0,
      deliveredAt: at,
      vantage: "test",
      quality: 0,
      active: false,
      staleness: 0,
      timelineEpoch: epoch,
    },
  });
}

function throttleFrame(
  throttle: number,
  timelineEpoch = 0,
  validAt = 1000,
  delay = 0,
) {
  return JSON.stringify({
    type: "stream-data",
    topic: "vessel.control",
    payload: { throttle },
    meta: {
      source: "test",
      validAt: validAt - delay,
      seq: 0,
      deliveredAt: validAt,
      vantage: "test",
      quality: 0,
      active: false,
      staleness: 0,
      timelineEpoch,
    },
  });
}

function gameState(state: string, scene: string) {
  return JSON.stringify({ type: "game-state", state, scene });
}

function timelineReset(keptThroughUt?: number) {
  return JSON.stringify({
    type: "event",
    topic: "vessel.control",
    name: "timeline-reset",
    ...(keptThroughUt === undefined ? {} : { keptThroughUt }),
    meta: {
      source: "test",
      validAt: 1000,
      seq: 1,
      deliveredAt: 1000,
      vantage: "test",
      quality: 0,
      active: true,
      staleness: 0,
      timelineEpoch: 1,
    },
  });
}

function Throttle() {
  const reading = useTelemetry("vessel.control");
  return (
    <div>
      <div>
        {reading.state === "held"
          ? `held:${reading.grade}`
          : reading.state === "observed"
            ? `observed:${probeText(reading.value.throttle)}`
            : reading.state}
      </div>
      {reading.state === "held" ? (
        <div>{`shows:${probeText(reading.value.throttle)}`}</div>
      ) : null}
    </div>
  );
}

async function mount(delay = 0) {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  let socket: { send: (data: string) => void } | undefined;
  server.use(
    link.addEventListener("connection", ({ client }) => {
      socket = client;
    }),
  );
  const view = render(
    <SitrepTelemetryProvider enabled host="localhost" port={8090}>
      <Throttle />
    </SitrepTelemetryProvider>,
  );
  await waitFor(() => expect(getSitrepTransportStatus()).toBe("connected"));
  await act(async () => {
    if (delay > 0) socket?.send(delayFrame(delay));
    socket?.send(throttleFrame(0.75, 0, 1000, delay));
  });
  expect(await screen.findByText("observed:0.75")).toBeTruthy();
  return { view, send: (data: string) => socket?.send(data) };
}

async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

describe("a timeline-reset after a load", () => {
  it("keeps the readings marked LOADING while the load runs and blanks them once it ends, until the Topic's first frame", async () => {
    const { send } = await mount();

    await act(async () => send(gameState("loading", "FLIGHT")));
    await advance(800);
    expect(screen.getByText("held:loading")).toBeTruthy();

    await act(async () => send(timelineReset(1000)));
    await advance(2000);
    expect(screen.getByText("held:loading")).toBeTruthy();

    await act(async () => send(gameState("ready", "FLIGHT")));
    expect(screen.queryByText(/held|observed/)).toBeNull();

    await act(async () => send(throttleFrame(0.25, 1, 1000.5)));
    expect(await screen.findByText("observed:0.25")).toBeTruthy();
  });

  it("blanks the Topic at the reset when the load kept no history", async () => {
    const { send } = await mount();

    await act(async () => send(gameState("loading", "FLIGHT")));
    await advance(800);
    expect(screen.getByText("held:loading")).toBeTruthy();

    await act(async () => send(timelineReset()));
    expect(screen.queryByText(/held|observed/)).toBeNull();

    await act(async () => send(gameState("ready", "FLIGHT")));
    await act(async () => send(throttleFrame(0.25, 1, 1000.5)));
    expect(await screen.findByText("observed:0.25")).toBeTruthy();
  });

  it.each([
    3, 1800,
  ])("with a %s s delay the readings marked LOADING hand straight over to the ones heard at the save, with no blank at ready", async (delay) => {
    const { send } = await mount(delay);

    await act(async () => send(gameState("loading", "FLIGHT")));
    await advance(800);
    await act(async () => send(timelineReset(1000 - delay)));
    await advance(2000);
    expect(screen.getByText("held:loading")).toBeTruthy();

    await act(async () => send(gameState("ready", "FLIGHT")));
    expect(screen.getByText("held:loading")).toBeTruthy();

    await act(async () => send(throttleFrame(0.5, 1, 1000 - delay, delay + 1)));
    expect(await screen.findByText("observed:0.5")).toBeTruthy();
  });

  it("with a delay, a Topic the mod never re-sends blanks once the grace after ready runs out", async () => {
    const { send } = await mount(3);

    await act(async () => send(gameState("loading", "FLIGHT")));
    await advance(800);
    await act(async () => send(timelineReset(997)));
    await act(async () => send(gameState("ready", "FLIGHT")));
    expect(screen.getByText("held:loading")).toBeTruthy();

    await advance(5100);
    expect(screen.queryByText(/held|observed/)).toBeNull();
  });

  it("with a delay, a re-send that arrives 4 s after ready still replaces the readings marked LOADING", async () => {
    const { send } = await mount(3);

    await act(async () => send(gameState("loading", "FLIGHT")));
    await advance(800);
    await act(async () => send(timelineReset(997)));
    await act(async () => send(gameState("ready", "FLIGHT")));
    await advance(4000);
    expect(screen.getByText("held:loading")).toBeTruthy();

    await act(async () => send(throttleFrame(0.5, 1, 997, 4)));
    expect(await screen.findByText("observed:0.5")).toBeTruthy();
  });

  it.each([
    0, 3,
  ])("a reading made after the save that reaches the screen once the load is under way never shows (delay %s s)", async (delay) => {
    const { send } = await mount(delay);

    await act(async () => send(gameState("loading", "FLIGHT")));
    await advance(800);
    await act(async () => send(timelineReset(1000 - delay)));
    await act(async () =>
      send(
        JSON.stringify({
          type: "stream-data",
          topic: "vessel.control",
          payload: { throttle: 0.9 },
          meta: {
            source: "test",
            validAt: 1050,
            seq: 2,
            deliveredAt: 1000,
            vantage: "test",
            quality: 0,
            active: false,
            staleness: 0,
            timelineEpoch: 0,
          },
        }),
      ),
    );
    await advance(2000);

    expect(screen.queryByText("shows:0.9")).toBeNull();
    expect(screen.getByText("shows:0.75")).toBeTruthy();
  });
});
