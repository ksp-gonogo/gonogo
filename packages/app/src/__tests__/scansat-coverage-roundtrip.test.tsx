import { clearRegistry, useTelemetry } from "@ksp-gonogo/core";
import { useStream } from "@ksp-gonogo/sitrep-client";
import { probeText, render, screen, waitFor } from "@ksp-gonogo/test-utils";
import { NULL_DISPLAY } from "@ksp-gonogo/ui-kit";
import { ws } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { SitrepTelemetryProvider } from "../telemetry/SitrepTelemetryProvider";
import type { LinkClient } from "../test/peerFakes";

/**
 * A real client stack (`SitrepTelemetryProvider` → live `WebSocketTransport` →
 * `TimelineStore` → `useStream`) subscribes, and a frame the (MSW-simulated)
 * mod publishes on the canonical wire string `scansat.coverage.<body>.<typeBit>`
 * (`ScanChannels.BodyTypeSubTopic`, a scalar percent) must reach the widget.
 * That is the exact string the SCANsat Uplink's coverage rows read, so this
 * catches a string mismatch anywhere across subscribe / carry / resolve /
 * deliver. Nothing internal is faked; MSW intercepts only the network boundary.
 */

const SITREP_URL = "ws://localhost:8090";
const link = ws.link(SITREP_URL);
const server = setupServer();

beforeAll(() => server.listen());
afterEach(() => {
  server.resetHandlers();
  clearRegistry();
});
afterAll(() => server.close());

function streamFrame(topic: string, payload: unknown): string {
  return JSON.stringify({
    type: "stream-data",
    topic,
    payload,
    meta: {
      source: "test",
      validAt: 1,
      seq: 0,
      deliveredAt: 1,
      vantage: "test",
      quality: 0,
      active: false,
      staleness: 0,
      timelineEpoch: 0,
    },
  });
}

// The per-(body,type) coverage read the SCANsat Uplink performs: a dynamic Topic with no `TopicId` member, so `useStream`.
function CoverageProbe() {
  const reading = useStream<number>("scansat.coverage.Kerbin.8");
  const pct = reading.state === "observed" ? reading.value : undefined;
  return <div>coverage:{pct === undefined ? NULL_DISPLAY : String(pct)}</div>;
}

// A static Topic read: proves the MSW + live-transport harness is sound, so a red coverage assertion is the dynamic path, never the harness.
function ControlProbe() {
  const reading = useTelemetry("vessel.control");
  const throttle =
    reading.state === "observed" ? reading.value.throttle : undefined;
  return (
    <div>throttle:{throttle == null ? NULL_DISPLAY : probeText(throttle)}</div>
  );
}

async function connectAndCaptureClient(): Promise<LinkClient[]> {
  const serverClients: LinkClient[] = [];
  server.use(
    link.addEventListener("connection", ({ client }) => {
      serverClients.push(client);
    }),
  );
  return serverClients;
}

describe("SCANsat coverage round-trip (canonical wire string, real client)", () => {
  it("HARNESS CONTROL: a static topic frame surfaces on the Topic read", async () => {
    const serverClients = await connectAndCaptureClient();

    const { unmount } = render(
      <SitrepTelemetryProvider
        enabled
        host="localhost"
        port={8090}
        carriedChannels={["vessel.control"]}
      >
        <ControlProbe />
      </SitrepTelemetryProvider>,
    );

    expect(await screen.findByText(`throttle:${NULL_DISPLAY}`)).toBeTruthy();
    await waitFor(() => expect(serverClients).toHaveLength(1));
    serverClients[0].send(streamFrame("vessel.control", { throttle: 0.75 }));
    expect(await screen.findByText("throttle:0.75")).toBeTruthy();

    unmount();
  });

  it("the mod's canonical coverage string reaches the widget as a scalar percent", async () => {
    const serverClients = await connectAndCaptureClient();

    const { unmount } = render(
      <SitrepTelemetryProvider
        enabled
        host="localhost"
        port={8090}
        carriedChannels={["scansat.coverage."]}
      >
        <CoverageProbe />
      </SitrepTelemetryProvider>,
    );

    expect(await screen.findByText(`coverage:${NULL_DISPLAY}`)).toBeTruthy();
    await waitFor(() => expect(serverClients).toHaveLength(1));
    // The mod publishes coverage.<body>.<type> as a scalar percent.
    serverClients[0].send(streamFrame("scansat.coverage.Kerbin.8", 42));
    expect(await screen.findByText("coverage:42")).toBeTruthy();

    unmount();
  });
});
