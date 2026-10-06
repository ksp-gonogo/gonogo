import { clearRegistry, useTelemetry } from "@ksp-gonogo/core";
import {
  act,
  probeText,
  render,
  screen,
  waitFor,
} from "@ksp-gonogo/test-utils";
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

/**
 * The mod says the game is loading, and a widget that knows nothing about it
 * reads held until the game is ready again. Everything between the socket and
 * the widget is real; only the network is intercepted.
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

function throttleFrame(throttle: number) {
  return JSON.stringify({
    type: "stream-data",
    topic: "vessel.control",
    payload: { throttle },
    meta: {
      source: "test",
      validAt: 1000,
      seq: 0,
      deliveredAt: 1000,
      vantage: "test",
      quality: 0,
      active: false,
      staleness: 0,
      timelineEpoch: 0,
    },
  });
}

function gameState(state: string, scene: string) {
  return JSON.stringify({ type: "game-state", state, scene });
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

describe("a game-state frame from the mod", () => {
  it("holds a widget's reading once a load has run long enough to show, and releases it when the game is ready", async () => {
    const { view, send } = await mount();

    await act(async () => send(gameState("loading", "FLIGHT")));
    await advance(300);
    expect(screen.getByText("observed:0.75")).toBeTruthy();

    await advance(500);
    expect(screen.getByText("held:loading")).toBeTruthy();
    await expectNoA11yViolations(view.container);

    await act(async () => send(gameState("ready", "FLIGHT")));
    expect(await screen.findByText("observed:0.75")).toBeTruthy();
  });

  it("never shows a load that ends before it could be read", async () => {
    const { send } = await mount();

    await act(async () => send(gameState("loading", "SPACECENTER")));
    await advance(300);
    await act(async () => send(gameState("ready", "SPACECENTER")));
    await advance(2000);

    expect(screen.getByText("observed:0.75")).toBeTruthy();
  });

  it("holds every reading at once at the main menu", async () => {
    const { send } = await mount();

    await act(async () => send(gameState("no-game", "MAINMENU")));

    expect(await screen.findByText("held:no-game")).toBeTruthy();
  });
});
