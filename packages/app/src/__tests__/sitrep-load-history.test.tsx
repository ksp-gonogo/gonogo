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

function throttleFrame(throttle: number, timelineEpoch = 0, validAt = 1000) {
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
      {reading.state === "held"
        ? `held:${reading.grade}`
        : reading.state === "observed"
          ? `observed:${probeText(reading.value.throttle)}`
          : reading.state}
    </div>
  );
}

async function mount() {
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
    socket?.send(throttleFrame(0.75));
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
});
