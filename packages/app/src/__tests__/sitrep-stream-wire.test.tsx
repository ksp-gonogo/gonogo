import { clearRegistry, useDataValue } from "@ksp-gonogo/core";
import { render, screen, waitFor } from "@ksp-gonogo/test-utils";
import { ws } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { SitrepTelemetryProvider } from "../telemetry/SitrepTelemetryProvider";

/**
 * Closes the untested seam from the browser-transport brief: the LIVE
 * `WebSocketTransport` running INSIDE the real `<SitrepTelemetryProvider>`,
 * end-to-end over the MSW `ws` boundary, asserting a frame on the socket flows
 * all the way to a widget re-render. Nothing internal is faked — the provider
 * builds its own real `WebSocketTransport` (no `transport` prop), which defaults
 * to `globalThis.WebSocket`. MSW's `ws` interceptor patches that same global in
 * `server.listen()` (which runs AFTER the app's `installDomStubs` no-op
 * WebSocket), so the transport talks to the mocked socket.
 *
 * This is the same network-boundary approach the transport's own unit test uses
 * in `@ksp-gonogo/sitrep-client`; here it additionally proves the app-layer wiring
 * (`useMemo` transport build, `TelemetryClient`, `TelemetryProvider`,
 * `useDataValue` shim, carried-channels gate) all connect the wire to the DOM.
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
  // A valid `stream-data` wire envelope. Built as a plain object (numeric enum
  // literals: Quality.OnRails === 0, Staleness.Fresh === 0) so the app package
  // needs no dependency on `@ksp-gonogo/sitrep-sdk` — `parseServerMessage` on the
  // receiving end is what actually validates the shape.
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

function Throttle() {
  const throttle = useDataValue("data", "f.throttle");
  return <div>throttle:{throttle === undefined ? "—" : String(throttle)}</div>;
}

describe("SitrepTelemetryProvider — live WebSocketTransport over MSW", () => {
  it("a frame on the real socket flows through the live transport to a widget re-render", async () => {
    const serverClients: Array<{ send: (data: string) => void }> = [];
    server.use(
      link.addEventListener("connection", ({ client }) => {
        serverClients.push(
          client as unknown as { send: (data: string) => void },
        );
      }),
    );

    const { unmount } = render(
      <SitrepTelemetryProvider
        enabled
        host="localhost"
        port={8090}
        carriedChannels={["vessel.control"]}
      >
        <Throttle />
      </SitrepTelemetryProvider>,
    );

    // Nothing yet — the socket is still opening / no frames delivered. Use
    // findBy, not getBy: the live transport's connect-time status update is an
    // async re-render, so this absorbs it inside act rather than letting it
    // escape the test's act boundary (the load-dependent "not wrapped in act"
    // warning this seam otherwise produces).
    expect(await screen.findByText("throttle:—")).toBeTruthy();

    // Once the provider's live transport has connected, push a frame; it must
    // decode through the real client and surface on the mapped read.
    await waitFor(() => expect(serverClients).toHaveLength(1));
    serverClients[0].send(streamFrame("vessel.control", { throttle: 0.75 }));

    // The frame's re-render is a genuinely-async live-WS update — wait for it
    // (findBy is act-wrapped) rather than asserting synchronously.
    expect(await screen.findByText("throttle:0.75")).toBeTruthy();

    // Drop the tree before the afterEach runs: `clearRegistry()` notifies every
    // live `useDataSourceSubscription`, and RTL's auto-cleanup lands AFTER this
    // file's own afterEach — so clearing first would setState into a still-
    // mounted Throttle with no act boundary around it.
    unmount();
  });
});
