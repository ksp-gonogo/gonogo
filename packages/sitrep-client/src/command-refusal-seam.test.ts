import { ManualClock } from "@ksp-gonogo/sitrep-server";
import { ws } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import refusalFrame from "./__fixtures__/command-refusal.wire.json" with {
  type: "json",
};
import { LOSS_MARGIN, TelemetryClient } from "./client";
import type { TransportStatus } from "./transport";
import { WebSocketTransport } from "./websocket-transport";

/**
 * The seam, TS half. The other half is
 * `Sitrep.Host.IntegrationTests/CommandRefusalTests`, whose socket test asks a
 * real engine for a command whose uplink is unavailable, reads the frame off a
 * real `ClientWebSocket`, and writes it to
 * `__fixtures__/command-refusal.wire.json`, asserting the committed copy still
 * matches.
 *
 * That fixture is the JOINT. Two green halves meeting at an assumption is what
 * let "commands just vanish" sit in the ledger for a month: engine tests proved
 * the drop, a client test proved silence becomes `lost`, and nothing asserted
 * the join. Here the bytes the engine actually emits are the bytes this test
 * feeds through the real `WebSocketTransport`, so if the engine's frame changes
 * the C# half goes red until the fixture is regenerated and this half goes red
 * if the client can no longer handle it.
 *
 * Only `requestId` is substituted, because it is per-dispatch by construction:
 * `code` and `message` are asserted to come through from the fixture verbatim.
 */

const SITREP_URL = "ws://localhost:8090";
const link = ws.link(SITREP_URL);
const server = setupServer();

beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const WAIT_TIMEOUT_MS = 4000;

function waitForStatus(
  transport: WebSocketTransport,
  target: TransportStatus,
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (transport.status === target) return resolve();
    const timer = setTimeout(() => {
      off();
      reject(new Error(`status never reached "${target}"`));
    }, WAIT_TIMEOUT_MS);
    const off = transport.onStatusChange((status) => {
      if (status === target) {
        clearTimeout(timer);
        off();
        resolve();
      }
    });
  });
}

describe("a refused command, engine frame to operator-visible failure", () => {
  it("surfaces the engine's E_UNAVAILABLE refusal as a failure naming the uplink, and never re-labels it lost", async () => {
    // The engine refuses on the dispatch it cannot carry, so the fake server
    // replies with the recorded frame the moment a command-request arrives.
    server.use(
      link.addEventListener("connection", ({ client }) => {
        client.addEventListener("message", (event) => {
          const parsed = JSON.parse(String(event.data));
          if (parsed.type !== "command-request") return;
          client.send(
            JSON.stringify({ ...refusalFrame, requestId: parsed.requestId }),
          );
        });
      }),
    );

    const clock = new ManualClock(0);
    const transport = new WebSocketTransport({ url: SITREP_URL });
    const client = new TelemetryClient(transport, clock);
    await waitForStatus(transport, "connected");
    // Exactly as TelemetryProvider wires it: a live one-way delay, so a loss
    // timer IS armed. The point of this test is that the refusal beats it.
    client.setDelaySource(() => 4);

    const { requestId, result } = client.dispatch("refusal.ping");
    const settled = result.then(
      () => "resolved",
      (e) => e,
    );

    const error = await settled;
    const status = client.getCommand(requestId);

    // The operator sees a FAILURE, not silence and not a hang.
    expect(status?.phase).toBe("failed");
    // Straight from the engine's own frame, not restated here.
    expect(error.code).toBe("E_UNAVAILABLE");
    expect(error.code).toBe(refusalFrame.code);
    expect(error.message).toBe(refusalFrame.message);
    // The whole operational value of the refusal: it names what to go and look
    // at, which "signal-lost" never could.
    expect(error.message).toContain("uplink");
    expect(error.message).toContain("test harness assembly not loaded");
    // An absent mod has not failed, so the sentence must not say it has.
    expect(error.message).not.toContain("has failed");

    // The misattribution, gone: advance well past the loss deadline (2 legs of
    // 4s, plus the margin) and the command must STILL read as a refusal. Before
    // this fix the engine said nothing here, the timer fired, and the operator
    // was told "signal-lost" about a link that was up the whole time.
    clock.advanceTo(2 * 4 + LOSS_MARGIN + 10);
    expect(client.getCommand(requestId)?.phase).toBe("failed");

    client.dispose();
  });
});
