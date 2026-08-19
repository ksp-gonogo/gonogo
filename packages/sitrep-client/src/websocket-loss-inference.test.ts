import type { ServerMessage } from "@ksp-gonogo/sitrep-sdk";
import { ManualClock } from "@ksp-gonogo/sitrep-server";
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
import { LOSS_MARGIN, TelemetryClient } from "./client";
import { makeMeta } from "./stub-transport";
import type { TransportStatus } from "./transport";
import { WebSocketTransport } from "./websocket-transport";

/**
 * The test whose ABSENCE let a dropped command hang for ever.
 *
 * `Transport.predictConfirmEta` was optional, `CourierTransport` implemented it, and
 * the production `WebSocketTransport` did not. So `etaConfirm` fell back to "now", no
 * loss timer armed, and `dispatch`'s promise never settled: twenty-two files of queue UI
 * able to display a lost command, and nothing in production able to mark one. There WAS
 * a loss-inference test, but only over the courier, which is the transport that already
 * worked. A suite can be green and prove nothing about the path that ships.
 *
 * These drive the REAL `WebSocketTransport` over MSW's ws link, the same
 * network-boundary pattern as `websocket-transport.test.ts`, and take the delay from the
 * authority exactly as `TelemetryProvider` does (`setDelaySource`), never from the
 * transport.
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
      reject(
        new Error(
          `status never reached "${target}" (last: "${transport.status}")`,
        ),
      );
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

function commandResponse(requestId: string, result: unknown): string {
  const message: ServerMessage = {
    type: "command-response",
    requestId,
    result,
    meta: makeMeta({ validAt: 1, deliveredAt: 1 }),
  } as ServerMessage;
  return JSON.stringify(message);
}

async function connected() {
  server.use(link.addEventListener("connection", () => {}));
  const clock = new ManualClock(0);
  const transport = new WebSocketTransport({ url: SITREP_URL });
  const client = new TelemetryClient(transport, clock);
  await waitForStatus(transport, "connected");
  return { clock, client, transport };
}

describe("loss inference over the production WebSocket transport", () => {
  it("settles a dropped command as lost, sized by the authority's delay", async () => {
    const { clock, client } = await connected();
    // 4s one way, as DelayAuthority reports it off `comms.delay`.
    client.setDelaySource(() => 4);

    const { requestId, result } = client.dispatch("vessel.staging.activate");
    const settled = result.then(
      () => "resolved",
      () => "rejected",
    );

    // A round trip is TWO legs, so the confirm is due at 8, not 4. This is the
    // assertion that fails if anyone sizes the deadline on one leg.
    expect(client.getCommand(requestId)?.etaConfirm).toBe(8);

    // The negative, and the one that fails if the margin is ever shortened into live
    // commands: still in flight right up to the deadline.
    clock.advanceTo(8 + LOSS_MARGIN - 0.001);
    expect(client.getCommand(requestId)?.phase).toBe("in-flight");

    clock.advanceTo(8 + LOSS_MARGIN);
    expect(client.getCommand(requestId)?.phase).toBe("lost");
    await expect(settled).resolves.toBe("rejected");
  });

  it("does not mark a command lost when the confirm arrives before the deadline", async () => {
    server.use(
      link.addEventListener("connection", ({ client: wsClient }) => {
        wsClient.addEventListener("message", (event) => {
          const msg = JSON.parse(String(event.data));
          if (msg.type === "command-request") {
            wsClient.send(commandResponse(msg.requestId, { ok: true }));
          }
        });
      }),
    );
    const clock = new ManualClock(0);
    const transport = new WebSocketTransport({ url: SITREP_URL });
    const client = new TelemetryClient(transport, clock);
    await waitForStatus(transport, "connected");
    client.setDelaySource(() => 4);

    const { requestId, result } = client.dispatch("vessel.staging.activate");
    await expect(result).resolves.toBeDefined();
    expect(client.getCommand(requestId)?.phase).toBe("confirmed");

    // The timer must be CANCELLED, not merely overtaken: advancing past the old
    // deadline may not flip an already-settled command.
    clock.advanceTo(8 + LOSS_MARGIN + 10);
    expect(client.getCommand(requestId)?.phase).toBe("confirmed");
  });

  it("sizes each deadline off the delay AT DISPATCH, not at wiring time", async () => {
    const { client } = await connected();
    let oneWay = 1;
    client.setDelaySource(() => oneWay);

    // A craft that moved between dispatches: the accessor is read per dispatch, so the
    // second command gets its own window rather than the first one's.
    const near = client.dispatch("vessel.control.setThrottle");
    void near.result.catch(() => undefined);
    expect(client.getCommand(near.requestId)?.etaConfirm).toBe(2);

    oneWay = 20;
    const far = client.dispatch("vessel.control.setThrottle");
    void far.result.catch(() => undefined);
    expect(client.getCommand(far.requestId)?.etaConfirm).toBe(40);
  });

  it("says so out loud when nothing can supply a deadline", async () => {
    const { client } = await connected();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    // No authority attached, and WebSocketTransport deliberately does not predict, so
    // this dispatch genuinely cannot be settled on silence. Doing that SILENTLY is how
    // the gap shipped, so the absence has to be audible.
    void client
      .dispatch("vessel.staging.activate")
      .result.catch(() => undefined);

    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toMatch(
      /cannot be settled on silence/,
    );
    warn.mockRestore();
  });
});
