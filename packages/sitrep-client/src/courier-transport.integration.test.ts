import { classifyCommandRejection } from "@ksp-gonogo/sitrep-sdk";
import {
  Courier,
  CourierTransport,
  ManualClock,
  StubNetwork,
} from "@ksp-gonogo/sitrep-server";
import { describe, expect, it } from "vitest";
import { LOSS_MARGIN, TelemetryClient } from "./client";

// These cases drive a real `TelemetryClient` over the delay-modelling
// server stack (`Courier` + `CourierTransport` + `StubNetwork`, all from
// `@ksp-gonogo/sitrep-server`). They live here: not in sitrep-server's own
// `courier-transport.test.ts`: because sitrep-server must not depend on
// sitrep-client: the natural DAG is `sitrep-sdk <- sitrep-server <-
// sitrep-client`, and this package already has a test-only devDependency on
// sitrep-server (see package.json) to support exactly this kind of
// integration proof.

describe("CourierTransport", () => {
  it("delivers a delayed stream sample to a real M2 TelemetryClient only after the delay elapses", () => {
    const clock = new ManualClock();
    const network = new StubNetwork();
    network.setDelay("KSC", "vessel", 2);
    const courier = new Courier({ clock, network });
    const transport = new CourierTransport({
      courier,
      node: "vessel",
      vantage: "KSC",
      clock,
    });
    const client = new TelemetryClient(transport);

    const received: unknown[] = [];
    client.subscribe("alt", (value) => received.push(value));

    courier.record("vessel", "alt", 100, 0);

    // Not delivered before the delay elapses.
    clock.advanceTo(1);
    expect(received).toHaveLength(0);

    // Delivered exactly when UT reaches validAt + delay, through the client's subscribe callback, unchanged by the delay model.
    clock.advanceTo(2);
    expect(received).toEqual([100]);
    expect(client.getValue("alt")).toBe(100);
  });

  it("resolves a dispatched command to confirmed after the full uplink+downlink round trip", async () => {
    const clock = new ManualClock();
    const network = new StubNetwork();
    network.setDelay("KSC", "vessel", 2);
    const courier = new Courier({ clock, network });
    courier.setCommandHandler((command) => ({ ok: command }));
    const transport = new CourierTransport({
      courier,
      node: "vessel",
      vantage: "KSC",
      clock,
    });
    const client = new TelemetryClient(transport, clock);

    const { requestId, result } = client.dispatch("deploy");
    // etaConfirm comes from the transport's predictConfirmEta (dispatch UT
    // 0 + roundTripEta 4). The client shares the same ManualClock as the
    // courier/transport so its loss timer lives in the same UT domain as
    // predictConfirmEta: required per the domain note on `Clock` (see
    // packages/sitrep-client/src/clock.ts). This test never lets that timer
    // fire: the confirmation below cancels it first, deterministically
    // (advanceTo(4) is still short of the loss deadline at 4 + LOSS_MARGIN).
    expect(client.getCommand(requestId)).toEqual({
      phase: "in-flight",
      requestId,
      etaConfirm: 4,
    });

    // Uplink elapsed (executes on the node) but confirmation still in flight downlink: the client must still see in-flight.
    clock.advanceTo(2);
    expect(client.getCommand(requestId)).toEqual({
      phase: "in-flight",
      requestId,
      etaConfirm: 4,
    });

    // Downlink elapsed: confirmation arrives back at the vantage, through the client's dispatch() promise, unchanged by the delay model.
    clock.advanceTo(4);
    await expect(result).resolves.toEqual({ ok: "deploy" });
    expect(client.getCommand(requestId)).toEqual({
      phase: "confirmed",
      requestId,
      result: { ok: "deploy" },
    });
  });

  it("does not deliver anything through the client once unsubscribed", () => {
    const clock = new ManualClock();
    const network = new StubNetwork();
    network.setDelay("KSC", "vessel", 2);
    const courier = new Courier({ clock, network });
    const transport = new CourierTransport({
      courier,
      node: "vessel",
      vantage: "KSC",
      clock,
    });
    const client = new TelemetryClient(transport);

    const received: unknown[] = [];
    const off = client.subscribe("alt", (value) => received.push(value));

    courier.record("vessel", "alt", 100, 0);
    off();

    clock.advanceTo(2);
    expect(received).toHaveLength(0);
  });
});

describe("CourierTransport + TelemetryClient client-side loss inference (Task 8)", () => {
  it("infers lost and rejects on honest silence when the node is unreachable", async () => {
    const clock = new ManualClock();
    const network = new StubNetwork();
    network.setDelay("KSC", "vessel", 2);
    network.setReachable("KSC", "vessel", false);
    const courier = new Courier({ clock, network });
    const transport = new CourierTransport({
      courier,
      node: "vessel",
      vantage: "KSC",
      clock,
    });
    const client = new TelemetryClient(transport, clock);

    const { requestId, result } = client.dispatch("deploy");
    expect(client.getCommand(requestId)).toEqual({
      phase: "in-flight",
      requestId,
      etaConfirm: 4,
    });

    clock.advanceTo(4 + LOSS_MARGIN);

    await expect(result).rejects.toMatchObject({ code: "E_LOST" });
    expect(client.getCommand(requestId)).toEqual({
      phase: "lost",
      requestId,
      reason: "signal-lost",
    });
  });

  it("a reachable command confirms before the predicted deadline, cancelling the loss timer for good", async () => {
    const clock = new ManualClock();
    const network = new StubNetwork();
    network.setDelay("KSC", "vessel", 2);
    const courier = new Courier({ clock, network });
    courier.setCommandHandler((command) => ({ ok: command }));
    const transport = new CourierTransport({
      courier,
      node: "vessel",
      vantage: "KSC",
      clock,
    });
    const client = new TelemetryClient(transport, clock);

    const { requestId, result } = client.dispatch("deploy");
    clock.advanceTo(4);
    await expect(result).resolves.toEqual({ ok: "deploy" });
    expect(client.getCommand(requestId)).toEqual({
      phase: "confirmed",
      requestId,
      result: { ok: "deploy" },
    });

    // Well past the would-be loss deadline: confirming must have cancelled the loss timer, so this never flips to lost.
    clock.advanceTo(4 + LOSS_MARGIN + 10);
    expect(client.getCommand(requestId)).toEqual({
      phase: "confirmed",
      requestId,
      result: { ok: "deploy" },
    });
  });
});

/**
 * Game time stops while the operator's wall clock keeps running: a KSC building
 * open in KSP, where no delayed command executes until the building closes.
 * The client's deadline runs on the wall clock, as it does in the app, while
 * the courier holds the command on the frozen game clock.
 */
describe("a command held by a frozen game clock", () => {
  function frozenGame() {
    const game = new ManualClock();
    const wall = new ManualClock();
    const network = new StubNetwork();
    network.setDelay("KSC", "home", 0);
    const courier = new Courier({ clock: game, network });
    const executed: string[] = [];
    courier.setCommandHandler((command) => {
      executed.push(command);
      return { success: true };
    });
    const courierTransport = new CourierTransport({
      courier,
      node: "home",
      vantage: "KSC",
      clock: game,
    });
    // The app's stream transport does not predict; the delay authority sizes the deadline.
    const transport = {
      get status() {
        return courierTransport.status;
      },
      send: courierTransport.send.bind(courierTransport),
      onMessage: courierTransport.onMessage.bind(courierTransport),
      onStatusChange: courierTransport.onStatusChange.bind(courierTransport),
    };
    const client = new TelemetryClient(transport, wall);
    client.setDelaySource(() => 0);
    return { game, wall, client, executed };
  }

  it("calls a timed-out command unconfirmed, never failed, while the game has not run it", async () => {
    const { wall, client, executed } = frozenGame();

    const { requestId, result } = client.dispatch("career.strategy.deactivate");
    wall.advanceTo(LOSS_MARGIN + 30);

    const rejection = await result.then(
      () => null,
      (err: unknown) => classifyCommandRejection(err),
    );
    expect(rejection?.kind).toBe("lost");
    expect(client.getCommand(requestId).phase).toBe("lost");
    expect(executed).toEqual([]);
  });

  it("reports the late execution when game time moves again", async () => {
    const { game, wall, client, executed } = frozenGame();

    const { requestId, result } = client.dispatch("career.strategy.deactivate");
    wall.advanceTo(LOSS_MARGIN + 30);
    await result.catch(() => undefined);

    game.advanceTo(1);

    expect(executed).toEqual(["career.strategy.deactivate"]);
    expect(client.getCommand(requestId)).toEqual({
      phase: "found",
      requestId,
      outcome: "ran",
      result: { success: true },
    });
  });
});
