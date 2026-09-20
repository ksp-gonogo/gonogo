import type { CommandStatus, ServerMessage } from "@ksp-gonogo/sitrep-sdk";
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

/**
 * Narrows a command status to the in-flight arm, which is the only one carrying
 * `etaConfirm`. The assertions used to read `?.etaConfirm` off the whole union,
 * so a command that had already been refused or lost produced `undefined` and a
 * "expected undefined to be 8" that named neither the phase nor the reason.
 */
function inFlight(
  status: CommandStatus | undefined,
): Extract<CommandStatus, { phase: "in-flight" }> {
  if (status?.phase !== "in-flight") {
    throw new Error(
      `expected an in-flight command, got ${status?.phase ?? "no command at all"}`,
    );
  }
  return status;
}

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
    expect(inFlight(client.getCommand(requestId)).etaConfirm).toBe(8);

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
    expect(inFlight(client.getCommand(near.requestId)).etaConfirm).toBe(2);

    oneWay = 20;
    const far = client.dispatch("vessel.control.setThrottle");
    void far.result.catch(() => undefined);
    expect(inFlight(client.getCommand(far.requestId)).etaConfirm).toBe(40);
  });

  it("says so out loud when nothing can supply a deadline", async () => {
    const { client } = await connected();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    /*
     * No authority attached, and WebSocketTransport deliberately does not
     * predict, so this dispatch genuinely cannot be settled on silence: the
     * absence has to be audible.
     */
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

/**
 * The engine's own flight time, told to the dispatching client and replacing
 * the deadline it could only guess at.
 *
 * A client can see exactly one delay, `comms.delay`, which is the ACTIVE
 * craft's path home. A command addressed anywhere else (a career order held at
 * home, a spend from a distant vessel) travels a different route, so a deadline
 * built from what the client can see grades it against the wrong flight. The
 * engine knows the real one because it is the thing that scheduled the
 * delivery, so it says so, correlated by the client's own request id.
 */
describe("command-accepted carries the engine's own flight time", () => {
  function commandAccepted(requestId: string, oneWaySeconds: number): string {
    return JSON.stringify({
      type: "command-accepted",
      requestId,
      oneWaySeconds,
    });
  }

  async function connectedEchoing(
    reply: (requestId: string) => string | undefined,
  ) {
    server.use(
      link.addEventListener("connection", ({ client: wsClient }) => {
        wsClient.addEventListener("message", (event) => {
          const msg = JSON.parse(String(event.data));
          if (msg.type !== "command-request") return;
          const frame = reply(msg.requestId);
          if (frame !== undefined) wsClient.send(frame);
        });
      }),
    );
    const clock = new ManualClock(0);
    const transport = new WebSocketTransport({ url: SITREP_URL });
    const client = new TelemetryClient(transport, clock);
    await waitForStatus(transport, "connected");
    return { clock, client };
  }

  it("re-arms the deadline off the engine's number, not the active craft's", async () => {
    // The engine routed this one over a 30s path; the client can only see the
    // active craft at 4s. Without the frame the command is graded lost at
    // 8 + margin while its reply is still legitimately in the air.
    const { clock, client } = await connectedEchoing((requestId) =>
      commandAccepted(requestId, 30),
    );
    client.setDelaySource(() => 4);

    const { requestId, result } = client.dispatch("career.tech.unlock");
    const settled = result.then(
      () => "resolved",
      () => "rejected",
    );
    await vi.waitFor(() =>
      expect(inFlight(client.getCommand(requestId)).etaConfirm).toBe(60),
    );

    // The old, wrong deadline passes and the command stays in flight. This is
    // the whole point: it used to die here.
    clock.advanceTo(8 + LOSS_MARGIN + 1);
    expect(client.getCommand(requestId)?.phase).toBe("in-flight");

    clock.advanceTo(60 + LOSS_MARGIN);
    expect(client.getCommand(requestId)?.phase).toBe("lost");
    await expect(settled).resolves.toBe("rejected");
  });

  it("leaves the dispatch-time deadline alone when no acceptance arrives", async () => {
    // A TrueNow command never rides light-time, so the engine sends no
    // acceptance. Absence must read as ordinary, not as a reason to disarm.
    const { clock, client } = await connectedEchoing(() => undefined);
    client.setDelaySource(() => 4);

    const { requestId, result } = client.dispatch("ksp.recover");
    void result.catch(() => undefined);

    expect(inFlight(client.getCommand(requestId)).etaConfirm).toBe(8);
    clock.advanceTo(8 + LOSS_MARGIN);
    expect(client.getCommand(requestId)?.phase).toBe("lost");
  });
});
