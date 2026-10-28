import { clearRegistry, SettingsService, useTelemetry } from "@ksp-gonogo/core";
import { act, render, waitFor } from "@ksp-gonogo/test-utils";
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
import { DATA_RATE_SETTING, syncDataRate } from "../telemetry/dataRate";
import { SitrepTelemetryProvider } from "../telemetry/SitrepTelemetryProvider";
import {
  getSitrepTransportStatus,
  resetSitrepRuntimeForTests,
} from "../telemetry/sitrepRuntime";
import { WidgetDataRateBridge } from "../telemetry/WidgetDataRateBridge";
import type { LinkClient } from "../test/peerFakes";

/**
 * A page left open across a game restart keeps its widgets' fast rate: the new
 * connection ends up with the Topic subscribed and at the fast tier, whether
 * the restarted mod is a new run or the same one.
 */

const link = ws.link("ws://localhost:8090");
const server = setupServer();

let stopDataRate: (() => void) | undefined;

beforeAll(() => server.listen());
afterEach(() => {
  stopDataRate?.();
  stopDataRate = undefined;
  server.resetHandlers();
  clearRegistry();
  resetSitrepRuntimeForTests();
  vi.useRealTimers();
});
afterAll(() => server.close());

interface Connection {
  client: LinkClient;
  received: { type: string; topic?: string; tier?: string }[];
}

/** What the mod holds for a connection once it has processed `received` in order: a rate counts only for a Topic subscribed at that moment, and an unsubscribe drops it. */
function modStateOf(connection: Connection) {
  const subscribed = new Set<string>();
  const tiers = new Map<string, string>();
  for (const m of connection.received) {
    if (m.topic === undefined) continue;
    if (m.type === "subscribe") subscribed.add(m.topic);
    if (m.type === "unsubscribe") {
      subscribed.delete(m.topic);
      tiers.delete(m.topic);
    }
    if (m.type === "set-rate" && subscribed.has(m.topic) && m.tier) {
      if (m.tier === "base") tiers.delete(m.topic);
      else tiers.set(m.topic, m.tier);
    }
  }
  return { subscribed, tiers };
}

function memoryStorage(): Storage {
  const m = new Map<string, string>();
  return {
    length: 0,
    clear: () => m.clear(),
    key: () => null,
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
  } as Storage;
}

const def = { dataRates: { fast: ["vessel.flight"] } };

function FastWidget() {
  useTelemetry("vessel.flight");
  return <WidgetDataRateBridge def={def} config={{}} />;
}

async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

describe("a page open across a game restart keeps its fast rate", () => {
  it.each([
    ["a new run of the game", ["run-a", "run-b"]],
    ["the same run", ["run-a", "run-a"]],
  ])("%s", async (_name, bootIds) => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const settings = new SettingsService(memoryStorage());
    settings.set(DATA_RATE_SETTING, "faster");
    stopDataRate = syncDataRate(settings);
    const connections: Connection[] = [];
    server.use(
      link.addEventListener("connection", ({ client }) => {
        const bootId = bootIds[connections.length] ?? "run-x";
        client.send(JSON.stringify({ type: "hello", bootId }));
        const connection: Connection = { client, received: [] };
        client.addEventListener("message", (event) =>
          connection.received.push(JSON.parse(String(event.data))),
        );
        connections.push(connection);
      }),
    );
    render(
      <SitrepTelemetryProvider enabled host="localhost" port={8090}>
        <FastWidget />
      </SitrepTelemetryProvider>,
    );
    await waitFor(() => expect(getSitrepTransportStatus()).toBe("connected"));
    await waitFor(() =>
      expect(modStateOf(connections[0]).tiers.get("vessel.flight")).toBe(
        "fast",
      ),
    );

    await act(async () => {
      connections[0].client.close();
    });
    await advance(5_000);
    await waitFor(() => expect(connections).toHaveLength(2));
    await waitFor(() => expect(getSitrepTransportStatus()).toBe("connected"));
    await advance(1_000);

    const state = modStateOf(connections[1]);
    expect(state.subscribed.has("vessel.flight")).toBe(true);
    expect(state.tiers.get("vessel.flight")).toBe("fast");
    await act(async () => {});
  });
});
