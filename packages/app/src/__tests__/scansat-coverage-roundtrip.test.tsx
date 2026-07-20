import { clearRegistry, useTelemetry } from "@ksp-gonogo/core";
import { render, screen, waitFor } from "@ksp-gonogo/test-utils";
import { ws } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { SitrepTelemetryProvider } from "../telemetry/SitrepTelemetryProvider";

/**
 * ACCEPTANCE / definition-of-done for the SCANsat dynamic-topic fix
 * (`local_docs/scansat-unified-fix-plan.md`, Task 4). A real client stack
 * (`SitrepTelemetryProvider` → live `WebSocketTransport` → `TimelineStore` →
 * carried-channels gate → `useTelemetry`) subscribes and a frame published by
 * the (MSW-simulated) mod on the ONE canonical wire string
 * `scansat.coverage.<body>.<typeBit>` — the exact string CoveragePanel reads
 * (`useTelemetry<number>("data", \`scansat.coverage.${bodyName}.${scanType}\`)`,
 * CoveragePanel/index.tsx:96-99) and the exact string the mod publishes
 * (`ScanChannels.BodyTypeSubTopic`, a scalar percent) — must reach the widget.
 *
 * This is the round-trip that a per-layer unit test can't give: it catches a
 * residual STRING mismatch anywhere across subscribe / carry / resolve /
 * deliver. Nothing internal is faked — MSW intercepts only the network
 * boundary, exactly like `sitrep-stream-wire.test.tsx` (whose static-topic
 * pass proves the harness itself is sound; the control test below re-proves it
 * here).
 *
 * Red-until-fixed by design: the scansat round-trip is `it.skip` until the two
 * client fixes land (unified plan Tasks 1+2 — `TimelineStore` prefix-aware
 * whole-topic resolution + the carried-gate prefix match). UNSKIP it as the
 * green gate when landing those. The mod-side gate-granularity/delivery fix
 * (Task 3) is proven separately at the host layer; here the mod is simulated
 * publishing what it really publishes, so this gate is exclusively the CLIENT
 * receive/resolve/carry half of the same canonical string.
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

// The exact per-(body,type) coverage read CoveragePanel performs — scalar
// percent under the 4-segment canonical string.
function CoverageProbe() {
  const pct = useTelemetry<number>("data", "scansat.coverage.Kerbin.8");
  return <div>coverage:{pct === undefined ? "—" : String(pct)}</div>;
}

// A static mapped control that already works today (mirrors
// sitrep-stream-wire.test.tsx: the read key `f.throttle` maps to raw topic
// `vessel.control` field `throttle`) — proves the MSW + live-transport harness
// is sound, so a red scansat assertion is the dynamic path, never the harness.
function ControlProbe() {
  const throttle = useTelemetry("data", "f.throttle");
  return <div>throttle:{throttle === undefined ? "—" : String(throttle)}</div>;
}

async function connectAndCaptureClient(): Promise<
  Array<{ send: (data: string) => void }>
> {
  const serverClients: Array<{ send: (data: string) => void }> = [];
  server.use(
    link.addEventListener("connection", ({ client }) => {
      serverClients.push(client as unknown as { send: (data: string) => void });
    }),
  );
  return serverClients;
}

describe("SCANsat coverage round-trip (canonical wire string, real client)", () => {
  it("HARNESS CONTROL: a static topic frame surfaces on the mapped read", async () => {
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

    expect(await screen.findByText("throttle:—")).toBeTruthy();
    await waitFor(() => expect(serverClients).toHaveLength(1));
    serverClients[0].send(streamFrame("vessel.control", { throttle: 0.75 }));
    expect(await screen.findByText("throttle:0.75")).toBeTruthy();

    unmount();
  });

  // GREEN GATE: unskip when unified-plan Tasks 1+2 land (TimelineStore
  // prefix-aware whole-topic resolution + carried-gate prefix match). The
  // intended wiring drives BOTH from the trailing-`.` entries in
  // `carriedChannels` (the store's `dynamicWholeTopicPrefixes` derived from the
  // same list) — if the client fix uses a different injection, adjust the
  // provider props here to match, keeping the assertion (value surfaces).
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

    expect(await screen.findByText("coverage:—")).toBeTruthy();
    await waitFor(() => expect(serverClients).toHaveLength(1));
    // The mod publishes coverage.<body>.<type> as a scalar percent.
    serverClients[0].send(streamFrame("scansat.coverage.Kerbin.8", 42));
    expect(await screen.findByText("coverage:42")).toBeTruthy();

    unmount();
  });
});
